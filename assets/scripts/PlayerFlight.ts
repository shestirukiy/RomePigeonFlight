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
import { GameManager } from './GameManager';
import { SoundController } from './SoundController';
import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

/**
 * Flight: RigidBody2D + lift; pitch from vertical velocity (inspector group Pitch).
 */
@ccclass('PlayerFlight')
export class PlayerFlight extends Component {
    @property({ group: 'Flight', tooltip: 'Сила при удержании ввода.' })
    liftForce = 10000;

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
    pitchFallBoost = 3.5;

    @property({
        group: 'Pitch',
        tooltip:
            'Плавность: 0 — резче и быстрее, 1 — мягче, меньше дрожания.',
    })
    pitchSmoothness = 0.45;

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
        group: 'Flight',
        displayName: 'Lock Horizontal X',
        tooltip:
            'Раннер-режим: игрок по X всегда стоит на месте, движется только мир. Убирает «уезд» игрока/камеры при ударах и вторых коллизиях.',
    })
    lockHorizontalX = true;

    private _body: RigidBody2D | null = null;
    private _held = false;
    private _anchorLocalX = 0;
    private readonly _spawnLocalPos = new Vec3();

    /** Seconds left: no lift force (electric stun, etc.). */
    private _electricLiftBlockRemain = 0;

    /** Сглаженная vy только для расчёта крена. */
    private _pitchVyFiltered = 0;

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
        return GameManager.game?.isWorldKickbackActive === true;
    }

    /**
     * Удар о стену: мир «отъезжает назад» относительно птицы (чанки вправо), импульс вниз опционально.
     */
    public applyTowerKnockback(
        durationSec: number,
        horizontalPxPerSec: number,
        downwardImpulse = 0,
    ): void {
        if (durationSec <= 0) {
            return;
        }
        GameManager.game?.applyWorldKickback(durationSec, horizontalPxPerSec);

        const body = this._body;
        if (body && downwardImpulse !== 0) {
            body.applyLinearImpulseToCenter(new Vec2(0, downwardImpulse), true);
        }
    }

    private _savedGravityScale = 1;

    onLoad() {
        this._spawnLocalPos.set(this.node.position);
        this._anchorLocalX = this._spawnLocalPos.x;
        if (!this.getComponent(PlayerController)) {
            this.addComponent(PlayerController);
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

        const playing = GameManager.game?.isPlaying === true;
        if (!playing) {
            body.gravityScale = 0;
            body.linearVelocity = new Vec2(0, 0);
            body.angularVelocity = 0;
            this._pitchVyFiltered = 0;
            this._electricLiftBlockRemain = 0;
            this._resetPitchAngle();
            return;
        }

        body.gravityScale = this._savedGravityScale;

        if (this._electricLiftBlockRemain > 0) {
            this._electricLiftBlockRemain = Math.max(
                0,
                this._electricLiftBlockRemain - dt,
            );
        }

        const canLift = this._electricLiftBlockRemain <= 0;
        if (canLift && this._held) {
            body.applyForceToCenter(new Vec2(0, this.liftForce), true);
        }

        const v = body.linearVelocity;
        let vy = v.y;
        if (vy > this.maxUpSpeed) {
            vy = this.maxUpSpeed;
        } else if (vy < -this.maxDownSpeed) {
            vy = -this.maxDownSpeed;
        }
        // Раннер: по X всегда 0 (мир/чанки двигаются сами).
        // Это гарантирует, что при “отскоке” и упоре во вторую стену игрок не уедет относительно кадра.
        const clipped = vy !== v.y;
        if (this.lockHorizontalX || Math.abs(v.x) > 1e-4 || clipped) {
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

    private _onBeforeDrawPitch() {
        const body = this._body;
        if (!body || GameManager.game?.isPlaying !== true) {
            return;
        }

        body.angularVelocity = 0;

        const vyRaw = body.linearVelocity.y;
        const dt = Math.max(game.deltaTime, 1e-6);
        const vySmooth = this._vySmoothRate();
        const k = Math.min(1, vySmooth * dt);
        this._pitchVyFiltered += (vyRaw - this._pitchVyFiltered) * k;
        const vy = this._pitchVyFiltered;

        const upSens = this.pitchStrength;
        const downSens = this.pitchStrength * this.pitchFallBoost;
        const sign = this.pitchInvert ? -1 : 1;

        let targetAngle: number;
        if (vy >= 0) {
            targetAngle = vy * upSens * sign;
            targetAngle = Math.min(targetAngle, this.pitchMaxDegUp);
        } else {
            targetAngle = vy * downSens * sign;
            targetAngle = Math.max(targetAngle, -this.pitchMaxDegDown);
        }

        const pivot = this.pitchVisual ?? this.node;
        const cur = pivot.angle;
        const t = Math.min(1, this._angleSmoothRate() * dt);
        pivot.angle = cur + (targetAngle - cur) * t;
    }

    private _resetPitchAngle() {
        if (this.pitchVisual) {
            this.pitchVisual.angle = 0;
        } else {
            this.node.angle = 0;
        }
    }

    /** Старт / рестарт забега: позиция и физика как в сцене при onLoad. */
    public resetToSpawn(): void {
        this._held = false;
        this._electricLiftBlockRemain = 0;
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
        if (GameManager.game?.isPlaying !== true) {
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
