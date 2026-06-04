import {
    _decorator,
    Component,
    Node,
    EventMouse,
    EventTouch,
    Input,
    RigidBody2D,
    ERigidBody2DType,
    Vec2,
    Vec3,
    director,
    Director,
    game,
    input,
} from 'cc';
import { GameSession, PLAYER_CONTROLLER_CCLASS } from './GameSession';
import { SoundController } from './SoundController';

const { ccclass, property, executionOrder } = _decorator;

/** После физики и скролла — возврат X на дорожку. */
const PLAYER_FLIGHT_EXEC_ORDER = 40;

/**
 * Flight: RigidBody2D + lift; pitch from vertical velocity (inspector group Pitch).
 */
@ccclass('PlayerFlight')
@executionOrder(PLAYER_FLIGHT_EXEC_ORDER)
export class PlayerFlight extends Component {
    @property({ group: 'Flight', tooltip: 'Сила при удержании ввода.' })
    liftForce = 4500;

    @property({ group: 'Flight', tooltip: 'Лимит скорости вверх.' })
    maxUpSpeed = 700;

    @property({ group: 'Flight', tooltip: 'Лимит скорости падения по модулю.' })
    maxDownSpeed = 2000;

    @property({
        group: 'Pitch',
        tooltip: 'Макс. угол носа вверх при подъёме (градусы).',
    })
    pitchMaxDegUp = 90;

    @property({
        group: 'Pitch',
        tooltip: 'Макс. угол носа вниз при падении (градусы).',
    })
    pitchMaxDegDown = 300;

    @property({
        group: 'Pitch',
        tooltip:
            'Насколько сильно крен реагирует на скорость (подъём). Падение усиливается отдельно — Pitch Fall Boost.',
    })
    pitchStrength = 0.3;

    @property({
        group: 'Pitch',
        tooltip:
            'Во сколько раз сильнее наклон при падении относительно подъёма (при падении |vy| обычно меньше). Типично 3–5.',
    })
    pitchFallBoost = 5;

    @property({
        group: 'Pitch',
        tooltip:
            'Плавность: 0 — резче и быстрее, 1 — мягче, меньше дрожания.',
    })
    pitchSmoothness = 0.33;

    @property({
        group: 'Pitch',
        tooltip: 'Инвертировать направление наклона.',
    })
    pitchInvert = false;

    @property({
        group: 'Pitch',
        type: Node,
        tooltip:
            'Узел, который только наклоняется (часто дочерний «Pigeon»). Пусто — ищется ребёнок с именем Pigeon, иначе крен на корне.',
    })
    pitchVisual: Node | null = null;

    @property({
        group: 'Pitch',
        type: [Node],
        displayName: 'Pitch Overlay Nodes',
        tooltip:
            'Доп. узлы с тем же креном, что pitchVisual (например Fedia поверх Pigeon). Пусто — ищется ребёнок Fedia.',
    })
    pitchOverlayNodes: Node[] = [];

    @property({
        group: 'Flight',
        displayName: 'Lock Horizontal X',
        tooltip:
            'Раннер-режим: игрок по X всегда стоит на месте, движется только мир. Убирает «уезд» игрока/камеры при ударах и вторых коллизиях.',
    })
    lockHorizontalX = true;

    @property({
        group: 'Flight',
        displayName: 'Runway snap epsilon (px)',
        tooltip:
            'Если |X − якорь| больше — сброс на якорь (кроме окна «урон/отдача»).',
    })
    runwaySnapEpsilonPx = 0.35;

    @property({
        group: 'Flight',
        displayName: 'Runway snap ease (s)',
        tooltip:
            'Плавный возврат локального X к 0 после урона / возобновления скролла. 0 — мгновенно.',
    })
    runwaySnapEaseSec = 0.28;

    @property({
        group: 'Flight',
        displayName: 'Scale Flight With World Speed',
        tooltip:
            'После первой пройденной вехи: лимиты vy и слабее подъём под скорость Plane 1 (вехи × parallax). ' +
            'До вехи — как без галочки. Pass Boost не учитывается.',
    })
    scaleFlightWithWorldSpeed = true;

    @property({
        group: 'Flight',
        displayName: 'Flight Speed Match',
        tooltip:
            'Доля прироста видимой скорости Plane 1 в лимиты vy. 1 = как чанки. Ниже — голубь отстаёт по вертикали.',
        min: 0,
        max: 1,
        step: 0.05,
        slide: true,
    })
    flightWorldSpeedMatch = 0.85;

    @property({
        group: 'Flight',
        displayName: 'Flight Gravity Match',
        tooltip:
            'Доля прироста в гравитацию (падение догоняет мир). 0 — только lift/лимиты. ~0.5 — баланс с креном.',
        min: 0,
        max: 1,
        step: 0.05,
        slide: true,
    })
    flightGravityMatch = 0.35;

    /** Локальный X в PlayerContainer — всегда 0 (дорожка раннера). */
    private static readonly RUNWAY_LOCAL_X = 0;

    private _body: RigidBody2D | null = null;
    private _held = false;
    /** Y/Z при рестарте; X дорожки фиксирован (RUNWAY_LOCAL_X). */
    private readonly _spawnLocalPos = new Vec3();

    /** Пока > 0 — разрешён сдвиг по X от коллизий (анимация урона / отдача). */
    private _allowHorizontalDriftRemain = 0;
    private _wasForwardScrollStopped = true;

    /** Seconds left: no lift force (electric stun, etc.). */
    private _electricLiftBlockRemain = 0;

    /** Сглаженная vy только для расчёта крена. */
    private _pitchVyFiltered = 0;

    private readonly _pitchOverlays: Node[] = [];

    /** Для анимаций / UI: удерживается ли тап или ЛКМ. */
    public get isInputHeld(): boolean {
        return this._held;
    }

    /** Сброс удержания (смерть, game over). */
    public releaseInput(): void {
        this._held = false;
    }

    /**
     * Blocks lift for the given duration (renewed if already blocked by a longer remaining time).
     * Called from PlayerController / hazards.
     */
    public setElectricLiftBlockedFor(seconds: number): void {
        if (seconds <= 0) {
            return;
        }
        this._electricLiftBlockRemain = Math.max(
            this._electricLiftBlockRemain,
            seconds,
        );
    }

    public get isElectricLiftBlocked(): boolean {
        return this._electricLiftBlockRemain > 0;
    }

    /** Горизонтально птица по X не ездит — отдача задаётся GameManager (мир смещается вправо). */
    public get isTowerKnockbackActive(): boolean {
        return GameSession.game?.isWorldKickbackActive === true;
    }

    /**
     * На время hazard-клипа / отдачи можно чуть сместиться по X; после — резинка на X=0.
     */
    public allowHorizontalDriftFor(seconds: number): void {
        if (seconds <= 0) {
            return;
        }
        this._allowHorizontalDriftRemain = Math.max(
            this._allowHorizontalDriftRemain,
            seconds,
        );
    }

    public applyTowerKnockback(
        durationSec: number,
        horizontalPxPerSec: number,
        downwardImpulse = 0,
    ): void {
        if (durationSec <= 0) {
            return;
        }
        this.allowHorizontalDriftFor(durationSec);
        GameSession.game?.applyWorldKickback(durationSec, horizontalPxPerSec);

        const body = this._body;
        if (body && downwardImpulse !== 0) {
            body.applyLinearImpulseToCenter(new Vec2(0, downwardImpulse), true);
        }
    }

    private _savedGravityScale = 1;

    onLoad() {
        const p = this.node.position;
        this._spawnLocalPos.set(PlayerFlight.RUNWAY_LOCAL_X, p.y, p.z);
        if (!this.getComponent(PLAYER_CONTROLLER_CCLASS)) {
            this.addComponent(PLAYER_CONTROLLER_CCLASS);
        }
        this._body = this.getComponent(RigidBody2D);
        if (this._body) {
            this._savedGravityScale = this._body.gravityScale;
            this._body.type = ERigidBody2DType.Dynamic;
            this._body.fixedRotation = true;
            // Lets physics report contacts (obstacles can listen; some setups need listener on dynamic body too).
            this._body.enabledContactListener = true;
        }

        if (!this.pitchVisual) {
            const pigeon = this.node.getChildByName('Pigeon');
            if (pigeon) {
                this.pitchVisual = pigeon;
            }
        }

        this._pitchOverlays.length = 0;
        for (const n of this.pitchOverlayNodes) {
            if (n?.isValid && this._pitchOverlays.indexOf(n) < 0) {
                this._pitchOverlays.push(n);
            }
        }
        const fedia = this.node.getChildByName('Fedia');
        if (fedia?.isValid && this._pitchOverlays.indexOf(fedia) < 0) {
            this._pitchOverlays.push(fedia);
        }

        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);

        director.on(Director.EVENT_BEFORE_DRAW, this._onBeforeDrawPitch, this);
    }

    onDestroy() {
        director.off(Director.EVENT_BEFORE_DRAW, this._onBeforeDrawPitch, this);

        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
    }

    update(dt: number) {
        const body = this._body;
        if (!body) {
            return;
        }

        const playing = GameSession.game?.isPlaying === true;
        if (!playing) {
            body.gravityScale = 0;
            body.linearVelocity = new Vec2(0, 0);
            body.angularVelocity = 0;
            this._pitchVyFiltered = 0;
            this._electricLiftBlockRemain = 0;
            this._resetPitchAngle();
            return;
        }

        const phys = this._flightPhysicsMultipliers();

        body.gravityScale = this._savedGravityScale * phys.gravity;

        if (this._electricLiftBlockRemain > 0) {
            this._electricLiftBlockRemain = Math.max(
                0,
                this._electricLiftBlockRemain - dt,
            );
        }

        const canLift = this._electricLiftBlockRemain <= 0;
        if (canLift && this._held) {
            body.applyForceToCenter(
                new Vec2(0, this.liftForce * phys.lift),
                true,
            );
        }

        const maxUp = this.maxUpSpeed * phys.maxUp;
        const maxDown = this.maxDownSpeed * phys.maxDown;
        const v = body.linearVelocity;
        let vy = v.y;
        if (vy > maxUp) {
            vy = maxUp;
        } else if (vy < -maxDown) {
            vy = -maxDown;
        }
        // Раннер: по X всегда 0 (мир/чанки двигаются сами).
        // Это гарантирует, что при “отскоке” и упоре во вторую стену игрок не уедет относительно кадра.
        const clipped = vy !== v.y;
        if (this.lockHorizontalX || Math.abs(v.x) > 1e-4 || clipped) {
            body.linearVelocity = new Vec2(0, vy);
        }
    }

    lateUpdate(dt: number): void {
        const gm = GameSession.game;
        const playing = gm?.isPlaying === true;
        if (!playing || !this.lockHorizontalX) {
            this._wasForwardScrollStopped = true;
            return;
        }

        if (this._allowHorizontalDriftRemain > 0) {
            this._allowHorizontalDriftRemain = Math.max(
                0,
                this._allowHorizontalDriftRemain - dt,
            );
            if (this._allowHorizontalDriftRemain <= 0) {
                this._snapRunwayHorizontal(true);
            }
            return;
        }

        const forward = gm.getForwardScrollDelta(dt);
        const forwardActive = forward > 0;
        if (this._wasForwardScrollStopped && forwardActive) {
            this._snapRunwayHorizontal(true);
        }
        this._wasForwardScrollStopped = !forwardActive;

        this._snapRunwayHorizontal(false);
    }

    private _snapRunwayHorizontal(force: boolean): void {
        if (!this.lockHorizontalX) {
            return;
        }
        if (!force && this._allowHorizontalDriftRemain > 0) {
            return;
        }
        const p = this.node.position;
        if (Math.abs(p.x - PlayerFlight.RUNWAY_LOCAL_X) <= this.runwaySnapEpsilonPx) {
            return;
        }
        this.node.setPosition(PlayerFlight.RUNWAY_LOCAL_X, p.y, p.z);
        const body = this._body;
        if (body) {
            const vy = body.linearVelocity.y;
            body.linearVelocity = new Vec2(0, vy);
        }
    }

    /** Чем выше pitchSmoothness, тем мягче следование углу (меньше коэффициент сглаживания угла). */
    private _angleSmoothRate(): number {
        const s = Math.min(1, Math.max(0, this.pitchSmoothness));
        return 18 - s * 12;
    }

    /** Чем выше pitchSmoothness, тем сильнее сглаживание vy → меньше дрожание крена. */
    private _vySmoothRate(): number {
        const s = Math.min(1, Math.max(0, this.pitchSmoothness));
        return 6 + s * 12;
    }

    /**
     * Смягчённый множитель под видимый скролл Plane 1 (вехи × parallax), без Pass Boost.
     */
    private _worldSpeedFlightFactor(): number {
        if (!this.scaleFlightWithWorldSpeed) {
            return 1;
        }
        const gm = GameSession.game;
        if (!gm?.isPlaying || gm.milestonesPassedCount <= 0) {
            return 1;
        }
        const world = Math.max(1, gm.getFlightScrollSpeedFactor());
        const match = Math.min(1, Math.max(0, this.flightWorldSpeedMatch));
        return 1 + (world - 1) * match;
    }

    /** До первой вехи все 1; после — lift/лимиты = factor, гравитация мягче (flightGravityMatch). */
    private _flightPhysicsMultipliers(): {
        lift: number;
        maxUp: number;
        maxDown: number;
        gravity: number;
    } {
        const one = { lift: 1, maxUp: 1, maxDown: 1, gravity: 1 };
        const f = this._worldSpeedFlightFactor();
        if (f <= 1.0001) {
            return one;
        }
        const gMatch = Math.min(1, Math.max(0, this.flightGravityMatch));
        const delta = f - 1;
        return {
            lift: f,
            maxUp: f,
            maxDown: f,
            gravity: 1 + delta * gMatch,
        };
    }

    /** Целевой крен: всегда vy × pitchStrength (падение × fall boost), лимиты Pitch Max Deg. */
    private _pitchTargetDeg(vy: number, sign: number): number {
        const upSens = this.pitchStrength;
        const downSens = this.pitchStrength * this.pitchFallBoost;
        if (vy >= 0) {
            let target = vy * upSens * sign;
            target = Math.min(target, this.pitchMaxDegUp);
            return target;
        }
        let target = vy * downSens * sign;
        target = Math.max(target, -this.pitchMaxDegDown);
        return target;
    }

    private _onBeforeDrawPitch() {
        const body = this._body;
        if (!body || GameSession.game?.isPlaying !== true) {
            return;
        }

        body.angularVelocity = 0;

        const vyRaw = body.linearVelocity.y;
        const dt = Math.max(game.deltaTime, 1e-6);
        const vySmooth = this._vySmoothRate();
        const k = Math.min(1, vySmooth * dt);
        this._pitchVyFiltered += (vyRaw - this._pitchVyFiltered) * k;
        const vy = this._pitchVyFiltered;

        const sign = this.pitchInvert ? -1 : 1;
        const targetAngle = this._pitchTargetDeg(vy, sign);

        const pivot = this.pitchVisual ?? this.node;
        const cur = pivot.angle;
        const t = Math.min(1, this._angleSmoothRate() * dt);
        const next = cur + (targetAngle - cur) * t;
        pivot.angle = next;
        for (const overlay of this._pitchOverlays) {
            if (overlay?.isValid) {
                overlay.angle = next;
            }
        }
    }

    private _resetPitchAngle() {
        if (this.pitchVisual) {
            this.pitchVisual.angle = 0;
        } else {
            this.node.angle = 0;
        }
        for (const overlay of this._pitchOverlays) {
            if (overlay?.isValid) {
                overlay.angle = 0;
            }
        }
    }

    /** Старт / рестарт забега: позиция и физика как в сцене при onLoad. */
    public resetToSpawn(): void {
        this._held = false;
        this._electricLiftBlockRemain = 0;
        this._allowHorizontalDriftRemain = 0;
        this._wasForwardScrollStopped = true;
        this._pitchVyFiltered = 0;
        this.node.setPosition(this._spawnLocalPos);
        this._resetPitchAngle();
        const body = this._body;
        if (body) {
            body.linearVelocity = new Vec2(0, 0);
            body.angularVelocity = 0;
        }
    }

    private _onTouchStart(_e: EventTouch) {
        this._onLiftInputDown();
    }

    private _onTouchEnd(_e: EventTouch) {
        this._held = false;
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._onLiftInputDown();
        }
    }

    private _onLiftInputDown(): void {
        const wasHeld = this._held;
        this._held = true;
        if (wasHeld) {
            return;
        }
        if (GameSession.game?.isPlaying !== true) {
            return;
        }
        if (this._electricLiftBlockRemain > 0) {
            return;
        }
        SoundController.instance?.tryPlayWingFlap();
    }

    private _onMouseUp(e: EventMouse) {
        if (e.getButton() === 0) {
            this._held = false;
        }
    }
}
