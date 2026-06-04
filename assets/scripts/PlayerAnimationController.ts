import {
    _decorator,
    Animation,
    AnimationClip,
    AnimationState,
    Canvas,
    Component,
    instantiate,
    Node,
    Tween,
    tween,
    Vec3,
} from 'cc';
import { GameManager } from './GameManager';
import { PlayerFlight } from './PlayerFlight';

const { ccclass, property } = _decorator;

type HpHarvestRun = {
    node: Node;
    slotIndex: number;
    phase: 'clip' | 'fly';
    clipName: string;
    clipDuration: number;
    clipElapsed: number;
    flyDuration: number;
    flyElapsed: number;
    startWorld: Vec3;
    targetWorld: Vec3;
    workPos: Vec3;
    onComplete: () => void;
    onClipFinished: (type?: string, state?: { name?: string }) => void;
};

/**
 * Анимации игрока на узле Player. Настройки расширяем по мере необходимости.
 * Сейчас: хлопанье крыльями — быстро при удержании, после отпускания плавное затухание (инерция).
 */
@ccclass('PlayerAnimationController')
export class PlayerAnimationController extends Component {
    @property({
        type: AnimationClip,
        displayName: 'Stay Clip',
        tooltip:
            'Ожидание тапа (до старта забега / после game over). Тот же клип в Clips у Animation.',
    })
    stayClip: AnimationClip | null = null;

    @property({
        type: AnimationClip,
        displayName: 'Flap Clip',
        tooltip:
            'Зацикленный клип хлопанья крыльями. Укажите тот же клип в массиве Clips компонента Animation.',
    })
    flapClip: AnimationClip | null = null;

    @property({
        displayName: 'Flap Speed (Pressed)',
        tooltip:
            'Скорость воспроизведения клипа при удержании экрана (быстрое хлопанье).',
    })
    flapSpeedPressed = 1.5;

    @property({
        displayName: 'Flap Speed (In Air)',
        tooltip:
            'Скорость клипа полёта без удержания (падение после платформы). 0 — замёрзший кадр до первого тапа.',
    })
    flapSpeedInAir = 0.65;

    @property({
        displayName: 'Wing Flap Inertia Duration',
        tooltip:
            'Секунды после отпускания: скорость хлопанья линейно падает до нуля (инерция крыльев).',
    })
    wingFlapInertiaDuration = 1;

    @property({
        type: AnimationClip,
        displayName: 'Electric Damage Clip',
        tooltip:
            'Опционально (например FlashDamage). Добавь тот же клип в массив Clips компонента Animation.',
    })
    electricDamageClip: AnimationClip | null = null;

    @property({
        type: AnimationClip,
        displayName: 'Wall Hit Clip',
        tooltip:
            'Удар о башню / стену. Тот же клип в массиве Clips у Animation.',
    })
    wallHitClip: AnimationClip | null = null;

    @property({
        type: AnimationClip,
        displayName: 'Surface Run Clip',
        tooltip:
            'Бег / скольжение по платформе снизу (пока игрок касается препятствия под ногами). ' +
            'Тот же клип в массиве Clips у Animation.',
    })
    surfaceRunClip: AnimationClip | null = null;

    @property({
        type: AnimationClip,
        displayName: 'Death Clip',
        tooltip:
            'Смерть на месте (0 HP не от Ground). Один раз; по окончании — game over. Тот же клип в Clips у Animation.',
    })
    deathClip: AnimationClip | null = null;

    @property({
        type: Node,
        displayName: 'Death Fall Node',
        tooltip:
            'Узел, который едет вниз при смерти (обычно PigeonBody). Пусто — Player/Pigeon/PigeonBody.',
    })
    deathFallNode: Node | null = null;

    @property({
        displayName: 'Death Fall Delta Y',
        tooltip:
            'На сколько local Y сместить узел за время death-клипа (от текущей позы, отрицательное = вниз).',
    })
    deathFallDeltaY = -1900;

    @property({
        displayName: 'Death Sequence Duration',
        tooltip:
            'Сколько ждать до game over, если длина клипа в Animation = 0. Обычно совпадает с PlayerDeath (~1.83).',
    })
    deathSequenceDurationSec = 1.85;

    @property({
        type: Node,
        displayName: 'HP Harvest Template',
        tooltip:
            'Шаблон hp_Icon на Player (скрыт). Для каждого +HP создаётся копия.',
    })
    hpHarvestNode: Node | null = null;

    @property({
        type: AnimationClip,
        displayName: 'HP Harvest Clip',
        tooltip:
            'HpHarvest: полёт к UI. Пусто — клип с Animation на HP Harvest Node.',
    })
    hpHarvestClip: AnimationClip | null = null;

    @property({
        displayName: 'HP Harvest Clip Min (s)',
        tooltip: 'Мин. длина фазы клипа, если duration в ассете = 0.',
    })
    hpHarvestClipMinSec = 0.5;

    @property({
        displayName: 'HP Harvest Fly Speed (px/s)',
        tooltip: 'Скорость полёта к слоту HP после окончания клипа.',
    })
    hpHarvestFlySpeedPxPerSec = 1020;

    private _anim: Animation | null = null;
    private _flapState: AnimationState | null = null;
    private _flight: PlayerFlight | null = null;

    private _electricOverlayRemain = 0;

    private _wallHitOverlayRemain = 0;

    /** Игрок на поверхности снизу — без остановки скролла, отдельный клип. */
    private _surfaceRunActive = false;

    private _flapSpeed = 0;

    /** Оставшееся время фазы затухания после отпускания. */
    private _tailTimeLeft = 0;

    /** С какой скорости клипа начали затухание. */
    private _speedAtTailStart = 0;

    private _wasHeld = false;

    /** Сейчас крутится stayClip (игра не идёт). */
    private _waitingStayActive = false;

    /** Проигрывается deathClip до вызова onComplete. */
    private _deathSequenceActive = false;

    /** Local position PigeonBody в префабе — сброс после забега. */
    private readonly _deathFallSpawnLocal = new Vec3();

    private _deathWingWasActive = true;

    private readonly _hpHarvestRuns: HpHarvestRun[] = [];
    private _hpHarvestSpawnSerial = 0;

    public get isHpHarvestActive(): boolean {
        return this._hpHarvestRuns.length > 0;
    }

    onLoad() {
        const pigeon = this._resolvePigeonRoot() ?? this.node;
        this._anim =
            pigeon.getComponent(Animation) ??
            this.getComponent(Animation) ??
            this.getComponentInChildren(Animation);
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;

        const fallNode = this._resolveDeathFallNode();
        if (fallNode) {
            this._deathFallSpawnLocal.set(fallNode.position);
        }
        this._hideHpHarvestTemplate();
    }

    start() {
        if (GameManager.game?.isPlaying !== true) {
            this.playWaitingStay();
        }
    }

    /**
     * Hazard layer: hold wing-flap logic while clip / timer runs.
     */
    public notifyElectricDamage(overlayDurationSec: number): void {
        if (
            overlayDurationSec <= 0 ||
            this._deathSequenceActive ||
            GameManager.game?.isDying
        ) {
            return;
        }
        this._surfaceRunActive = false;
        this._electricOverlayRemain = Math.max(
            this._electricOverlayRemain,
            overlayDurationSec,
        );
        this._ensureFlapState();
        if (this.electricDamageClip && this._anim) {
            this._anim.play(this.electricDamageClip.name);
        }
        if (this._flapState) {
            this._applyFlapSpeed(0);
        }
    }

    /**
     * Контакт с твёрдой поверхностью снизу (не скролл-стоп): зацикленный клип поверхности.
     * Приоритет ниже удара облака и стены.
     */
    public setRunningOnSurface(active: boolean): void {
        /* PlayerPathSensors.update идёт после физики в том же кадре — иначе бег по земле перебивает клип удара. */
        if (
            active &&
            (this._wallHitOverlayRemain > 0 || this._electricOverlayRemain > 0)
        ) {
            return;
        }
        if (this._surfaceRunActive === active) {
            return;
        }
        this._surfaceRunActive = active;
        if (active && this.surfaceRunClip && this._anim) {
            this._anim.play(this.surfaceRunClip.name);
            return;
        }
        /* Контакт с поверхностью закончился — снова клип полёта (не перебиваем удар облака/стены). */
        if (
            !active &&
            this._wallHitOverlayRemain <= 0 &&
            this._electricOverlayRemain <= 0
        ) {
            this._resumeFlapPlayback(true);
        }
    }

    /** Препятствие «стена»: пауза хлопанья на время клипа удара. */
    public notifyWallHit(overlayDurationSec: number): void {
        if (overlayDurationSec <= 0 || this._deathSequenceActive || GameManager.game?.isDying) {
            return;
        }
        this._surfaceRunActive = false;
        this._wallHitOverlayRemain = Math.max(
            this._wallHitOverlayRemain,
            overlayDurationSec,
        );
        this._ensureFlapState();
        if (this.wallHitClip && this._anim) {
            this._anim.play(this.wallHitClip.name);
        }
        if (this._flapState) {
            this._applyFlapSpeed(0);
        }
    }

    private _ensureFlapState(): void {
        if (!this.flapClip || !this._anim || this._flapState) {
            return;
        }
        const name = this.flapClip.name;
        this._anim.play(name);
        this._flapState = this._anim.getState(name);
    }

    /**
     * После hazard-клипа или схода с платформы — снова клип полёта.
     * @param fromSurfaceEnd после бега: сразу «в воздухе», без ожидания тапа.
     */
    private _resumeFlapPlayback(fromSurfaceEnd = false): void {
        if (!this.flapClip || !this._anim) {
            return;
        }
        this._tailTimeLeft = 0;
        if (fromSurfaceEnd) {
            this._wasHeld = false;
            this._restoreFlapClip(this.flapSpeedInAir);
            return;
        }
        this._wasHeld = this._flight?.isInputHeld === true;
        this._restoreFlapClip(this._wasHeld ? this.flapSpeedPressed : this.flapSpeedInAir);
    }

    /**
     * 0 HP в воздухе: смерть на месте; по окончании клипа — onComplete (обычно gameOver).
     * @returns false если клипа нет — вызывающий сразу завершает забег.
     */
    public playDeath(onComplete?: () => void): boolean {
        this.unschedule(this._onDeathSequenceEnd);
        this._deathSequenceActive = true;
        this._electricOverlayRemain = 0;
        this._wallHitOverlayRemain = 0;
        this._surfaceRunActive = false;
        this._tailTimeLeft = 0;
        this._wasHeld = false;
        this._waitingStayActive = false;
        this._flapState = null;

        if (!this._anim || !this.deathClip) {
            this._deathSequenceActive = false;
            return false;
        }

        this._ensureClipOnAnimator(this.deathClip);

        const name = this.deathClip.name;
        this._stopAllAnimatorStates();
        if (typeof this._anim.crossFade === 'function') {
            this._anim.crossFade(name, 0);
        } else {
            this._anim.play(name);
        }

        const st = this._anim.getState(name);
        if (st) {
            st.wrapMode = AnimationClip.WrapMode.Normal;
            st.speed = 1;
            st.time = 0;
            st.sample();
            st.resume();
        }

        const duration = this._resolveDeathSequenceDuration(st);
        this._hideWingForDeath();
        this._startDeathFallTween(duration);
        this.scheduleOnce(this._onDeathSequenceEnd, duration);
        this._deathCompleteCallback = onComplete ?? null;
        return true;
    }

    private _ensureClipOnAnimator(clip: AnimationClip): void {
        if (!this._anim) {
            return;
        }
        const clips = this._anim.clips;
        if (clips.indexOf(clip) >= 0) {
            return;
        }
        this._anim.addClip(clip);
    }

    /** Снять PlayerFly / Stay и др., чтобы deathClip единолично вёл spriteFrame. */
    private _stopAllAnimatorStates(): void {
        if (!this._anim) {
            return;
        }
        this._anim.stop();
        for (const clip of this._anim.clips) {
            if (!clip) {
                continue;
            }
            const st = this._anim.getState(clip.name);
            if (st) {
                st.stop();
            }
        }
    }

    private _resolveDeathSequenceDuration(st: AnimationState | null): number {
        let duration = this.deathSequenceDurationSec;
        if (this.deathClip && this.deathClip.duration > 0) {
            duration = Math.max(duration, this.deathClip.duration);
        }
        if (st && st.duration > 0) {
            duration = Math.max(
                duration,
                st.duration / Math.max(Math.abs(st.speed), 1e-5),
            );
        }
        return Math.max(0.05, duration);
    }

    private _deathCompleteCallback: (() => void) | null = null;

    private _onDeathSequenceEnd = (): void => {
        if (!this._deathSequenceActive) {
            return;
        }
        this._deathSequenceActive = false;
        const cb = this._deathCompleteCallback;
        this._deathCompleteCallback = null;
        cb?.();
    };

    private _resolvePigeonRoot(): Node | null {
        if (this.node.name === 'Pigeon') {
            return this.node;
        }
        return this.node.getChildByName('Pigeon');
    }

    /** Спрайт тела — всегда PigeonBody, не путать с узлом падения. */
    private _resolvePigeonBodyNode(): Node | null {
        return this._resolvePigeonRoot()?.getChildByName('PigeonBody') ?? null;
    }

    private _resolveDeathFallNode(): Node | null {
        if (this.deathFallNode?.isValid) {
            const body = this._resolvePigeonBodyNode();
            if (body && this.deathFallNode !== body) {
                const name = this.deathFallNode.name;
                if (name === 'Pigeon' || name === 'Player') {
                    return body;
                }
            }
            return this.deathFallNode;
        }
        return this._resolvePigeonBodyNode();
    }

    /** Падение вниз от текущей local-позы (без сброса к 0-му кадру клипа). */
    private _startDeathFallTween(durationSec: number): void {
        const fallNode = this._resolveDeathFallNode();
        if (!fallNode || Math.abs(this.deathFallDeltaY) < 1e-3) {
            return;
        }
        Tween.stopAllByTarget(fallNode);
        const from = fallNode.position.clone();
        const to = new Vec3(from.x, from.y + this.deathFallDeltaY, from.z);
        tween(fallNode).to(durationSec, { position: to }, { easing: 'quadIn' }).start();
    }

    private _resetDeathFallPose(): void {
        const fallNode = this._resolveDeathFallNode();
        if (!fallNode?.isValid) {
            return;
        }
        Tween.stopAllByTarget(fallNode);
        fallNode.setPosition(this._deathFallSpawnLocal);

        const wing = fallNode.getChildByName('PigeonFlyWing');
        if (wing?.isValid) {
            wing.active = this._deathWingWasActive;
        }
    }

    /** После смерти playDeath выключает узел — для забега / бега снова включаем. */
    private _restoreWingVisibility(): void {
        const wing = this._resolvePigeonBodyNode()?.getChildByName('PigeonFlyWing');
        if (wing?.isValid) {
            wing.active = true;
        }
    }

    /** Спрайты тела/ног — только из deathClip; код лишь прячет крыло, если клип его не гасит. */
    private _hideWingForDeath(): void {
        const wing = this._resolvePigeonBodyNode()?.getChildByName('PigeonFlyWing');
        if (wing?.isValid) {
            this._deathWingWasActive = wing.active;
            wing.active = false;
        }
    }

    /** Рестарт забега: сброс стана / удара и снова клип полёта. */
    /**
     * Копия hp_Icon: клип HpHarvest → полёт к UI → onComplete (можно несколько параллельно).
     */
    public playHpHarvest(
        targetWorldPos: Vec3,
        slotIndex: number,
        onComplete: () => void,
    ): boolean {
        if (this._deathSequenceActive) {
            return false;
        }

        const template = this._resolveHpHarvestTemplate();
        if (!template?.isValid) {
            console.warn(
                '[PlayerAnimationController] HpHarvest: нет шаблона hp_Icon.',
            );
            return false;
        }

        const copy = this._spawnHpHarvestCopy(template);
        if (!copy?.isValid) {
            return false;
        }

        const anim = copy.getComponent(Animation);
        const clip = this._resolveHpHarvestClip(anim);
        if (!anim || !clip?.name) {
            copy.destroy();
            return false;
        }

        const clipName = clip.name || 'HpHarvest';
        const clipDur = clip.duration > 0 ? clip.duration : 0;
        const clipDuration =
            clipDur > 0.05 ? clipDur : this.hpHarvestClipMinSec;

        const run: HpHarvestRun = {
            node: copy,
            slotIndex,
            phase: 'clip',
            clipName,
            clipDuration,
            clipElapsed: 0,
            flyDuration: 0,
            flyElapsed: 0,
            startWorld: new Vec3(),
            targetWorld: targetWorldPos.clone(),
            workPos: new Vec3(),
            onComplete,
            onClipFinished: () => {},
        };
        copy.getWorldPosition(run.startWorld);

        run.onClipFinished = (_type?: string, st?: { name?: string }) => {
            if (st?.name && st.name !== run.clipName) {
                return;
            }
            this._beginHpHarvestFlyPhase(run);
        };

        anim.stop();
        const st = anim.getState(clipName);
        if (st) {
            st.wrapMode = AnimationClip.WrapMode.Normal;
            st.speed = 1;
        }
        anim.play(clipName);
        anim.on(Animation.EventType.FINISHED, run.onClipFinished, this);

        this._hpHarvestRuns.push(run);

        const flyDist = Vec3.distance(run.startWorld, run.targetWorld);
        const flyDur =
            flyDist / Math.max(80, this.hpHarvestFlySpeedPxPerSec);
        this.scheduleOnce(() => {
            if (this._hpHarvestRuns.indexOf(run) >= 0) {
                this._finishHpHarvestRun(run, false);
            }
        }, clipDuration + flyDur + 0.4);

        return true;
    }

    private _spawnHpHarvestCopy(template: Node): Node | null {
        const copy = instantiate(template);
        if (!copy?.isValid) {
            return null;
        }

        this._hpHarvestSpawnSerial += 1;
        copy.name = `hp_Harvest_${this._hpHarvestSpawnSerial}`;

        const parent = template.parent;
        if (!parent?.isValid) {
            copy.destroy();
            return null;
        }

        copy.setParent(parent, false);
        copy.setPosition(template.position);
        copy.setRotation(template.rotation);
        copy.setScale(template.scale);
        copy.active = true;
        return copy;
    }

    private _beginHpHarvestFlyPhase(run: HpHarvestRun): void {
        if (run.phase !== 'clip' || !run.node?.isValid) {
            return;
        }

        const anim = run.node.getComponent(Animation);
        anim?.off(Animation.EventType.FINISHED, run.onClipFinished, this);
        anim?.stop();

        run.phase = 'fly';
        run.flyElapsed = 0;
        run.node.getWorldPosition(run.startWorld);
        if (run.slotIndex >= 0) {
            run.slotIndex =
                GameManager.game?.resolveHeartHarvestSlotIndex(
                    run.slotIndex,
                ) ?? run.slotIndex;
            GameManager.game?.getHeartSlotWorldPosition(
                run.slotIndex,
                run.targetWorld,
            );
        }
        this._attachHarvestNodeForFlight(run.node);

        const flyDist = Vec3.distance(run.startWorld, run.targetWorld);
        const speed = Math.max(80, this.hpHarvestFlySpeedPxPerSec);
        run.flyDuration = Math.max(0.15, flyDist / speed);
    }

    public resetForNewRun(): void {
        this._cancelHpHarvest();
        this.unschedule(this._onDeathSequenceEnd);
        this._deathSequenceActive = false;
        this._deathCompleteCallback = null;
        this._resetDeathFallPose();
        this._restoreWingVisibility();
        this._electricOverlayRemain = 0;
        this._wallHitOverlayRemain = 0;
        this._surfaceRunActive = false;
        this._tailTimeLeft = 0;
        this._wasHeld = false;
        this._waitingStayActive = false;
        this._flapSpeed = this.flapSpeedInAir;
        this._restoreFlapClip(this.flapSpeedInAir);
    }

    /** Ожидание тапа: PlayerStay (до старта и после game over). */
    public playWaitingStay(): void {
        this._electricOverlayRemain = 0;
        this._wallHitOverlayRemain = 0;
        this._surfaceRunActive = false;
        this._tailTimeLeft = 0;
        this._wasHeld = false;
        this._flapState = null;

        if (!this._anim || !this.stayClip) {
            this._waitingStayActive = false;
            this._flapSpeed = 0;
            this._restoreFlapClip(0, 0);
            return;
        }

        const name = this.stayClip.name;
        const cur = this._anim.getState(name);
        if (this._waitingStayActive && cur?.isPlaying) {
            return;
        }

        this._waitingStayActive = true;
        this._anim.stop();
        this._anim.play(name);
        const st = this._anim.getState(name);
        if (!st) {
            this._waitingStayActive = false;
            return;
        }
        st.wrapMode = AnimationClip.WrapMode.Loop;
        st.speed = 1;
        st.resume();
    }

    /** @deprecated Используйте playWaitingStay */
    public freezeIdleFlightPose(): void {
        this.playWaitingStay();
    }

    private _exitWaitingStay(): void {
        this._waitingStayActive = false;
    }

    private _restoreFlapClip(speed: number, sampleTime = 0): void {
        if (!this.flapClip || !this._anim) {
            return;
        }
        this._anim.stop();
        const name = this.flapClip.name;
        this._anim.play(name);
        this._flapState = this._anim.getState(name);
        if (!this._flapState) {
            return;
        }
        this._flapState.time = sampleTime;
        this._flapSpeed = speed;
        this._applyFlapSpeed(speed);
    }

    update(dt: number) {
        this._tickHpHarvestRuns(dt);

        if (this._deathSequenceActive) {
            return;
        }

        const playing = GameManager.game?.isPlaying === true;
        const dying = GameManager.game?.isDying === true;
        if (!playing || !this._anim) {
            if (!playing && !dying && !this._waitingStayActive) {
                this.playWaitingStay();
            }
            this._tailTimeLeft = 0;
            this._wasHeld = false;
            this._electricOverlayRemain = 0;
            this._wallHitOverlayRemain = 0;
            this._surfaceRunActive = false;
            return;
        }

        this._exitWaitingStay();

        const prevWall = this._wallHitOverlayRemain;
        const prevElec = this._electricOverlayRemain;
        this._wallHitOverlayRemain = Math.max(0, this._wallHitOverlayRemain - dt);
        this._electricOverlayRemain = Math.max(0, this._electricOverlayRemain - dt);

        if (this._wallHitOverlayRemain > 0) {
            this._ensureFlapState();
            if (this._flapState) {
                this._flapState.pause();
            }
            return;
        }

        if (this._electricOverlayRemain > 0) {
            this._ensureFlapState();
            if (this._flapState) {
                this._flapState.pause();
            }
            return;
        }

        if (
            (prevWall > 0 || prevElec > 0) &&
            this._wallHitOverlayRemain <= 0 &&
            this._electricOverlayRemain <= 0
        ) {
            if (GameManager.game?.isAwaitingDeathSequence) {
                return;
            }
            if (this._surfaceRunActive && this.surfaceRunClip) {
                this._anim.play(this.surfaceRunClip.name);
            } else {
                this._resumeFlapPlayback();
            }
        }

        if (GameManager.game?.isAwaitingDeathSequence) {
            return;
        }

        if (
            this._surfaceRunActive &&
            this.surfaceRunClip &&
            this._wallHitOverlayRemain <= 0 &&
            this._electricOverlayRemain <= 0
        ) {
            if (this._flapState) {
                this._flapState.pause();
            }
            return;
        }

        if (!this.flapClip) {
            return;
        }

        if (!this._flapState) {
            const name = this.flapClip.name;
            this._anim.play(name);
            this._flapState = this._anim.getState(name);
            if (!this._flapState) {
                return;
            }
        }

        const held = this._flight?.isInputHeld === true;

        if (held) {
            this._tailTimeLeft = 0;
            this._flapSpeed = this.flapSpeedPressed;
        } else {
            if (this._wasHeld) {
                this._tailTimeLeft = this.wingFlapInertiaDuration;
                this._speedAtTailStart = this.flapSpeedPressed;
            }

            const d = this.wingFlapInertiaDuration;
            if (this._tailTimeLeft > 0 && d > 0) {
                this._tailTimeLeft -= dt;
                if (this._tailTimeLeft < 0) {
                    this._tailTimeLeft = 0;
                }
                const elapsed = d - this._tailTimeLeft;
                const k = Math.min(1, Math.max(0, elapsed / d));
                this._flapSpeed = this._speedAtTailStart * (1 - k);
            } else {
                this._flapSpeed = this.flapSpeedInAir;
            }
        }

        this._wasHeld = held;
        this._applyFlapSpeed(this._flapSpeed);
    }

    /** Не зависит от ранних return в update (стан, удар, surface run). */
    private _tickHpHarvestRuns(dt: number): void {
        for (let i = this._hpHarvestRuns.length - 1; i >= 0; i--) {
            const run = this._hpHarvestRuns[i];
            if (!run.node?.isValid) {
                this._finishHpHarvestRun(run, true);
                continue;
            }
            if (run.phase === 'clip') {
                run.clipElapsed += dt;
                if (run.clipElapsed >= run.clipDuration) {
                    this._beginHpHarvestFlyPhase(run);
                }
                continue;
            }

            run.flyElapsed += dt;
            const duration = run.flyDuration;
            const t =
                duration > 0
                    ? Math.min(1, run.flyElapsed / duration)
                    : 1;

            Vec3.lerp(
                run.workPos,
                run.startWorld,
                run.targetWorld,
                t,
            );
            run.node.setWorldPosition(run.workPos);

            if (t >= 1) {
                run.node.setWorldPosition(run.targetWorld);
                this._finishHpHarvestRun(run, false);
            }
        }
    }

    private _resolveHpHarvestTemplate(): Node | null {
        if (this.hpHarvestNode?.isValid) {
            return this.hpHarvestNode;
        }
        let scope: Node | null = this.node;
        while (scope?.isValid) {
            for (const child of scope.children) {
                if (child.name === 'hp_Icon') {
                    return child;
                }
            }
            scope = scope.parent;
        }
        return null;
    }

    /** Во время полёта — в тот же UI-контейнер, что и полоска HP. */
    private _attachHarvestNodeForFlight(node: Node): void {
        const flyParent = this._resolveHpHarvestFlyParent();
        if (!flyParent?.isValid || node.parent === flyParent) {
            return;
        }
        const world = node.worldPosition.clone();
        node.setParent(flyParent, true);
        node.setWorldPosition(world);
        node.setSiblingIndex(flyParent.children.length - 1);
    }

    private _resolveHpHarvestFlyParent(): Node | null {
        const anchor = GameManager.game?.hpHeartAnchor;
        if (anchor?.parent?.isValid) {
            return anchor.parent;
        }
        const canvas =
            this.node.scene?.getComponentInChildren(Canvas)?.node ?? null;
        return canvas?.isValid ? canvas : null;
    }

    private _resolveHpHarvestClip(anim: Animation | null): AnimationClip | null {
        if (this.hpHarvestClip?.name) {
            return this.hpHarvestClip;
        }
        if (!anim) {
            return null;
        }
        for (const c of anim.clips) {
            if (c?.name === 'HpHarvest') {
                return c;
            }
        }
        return anim.defaultClip;
    }

    private _hideHpHarvestTemplate(): void {
        const template = this._resolveHpHarvestTemplate();
        if (!template?.isValid) {
            return;
        }
        template.getComponent(Animation)?.stop();
        template.active = false;
    }

    private _cancelHpHarvest(): void {
        const runs = this._hpHarvestRuns.slice();
        for (const run of runs) {
            this._finishHpHarvestRun(run, true);
        }
        this._hideHpHarvestTemplate();
    }

    private _finishHpHarvestRun(run: HpHarvestRun, cancelled: boolean): void {
        const idx = this._hpHarvestRuns.indexOf(run);
        if (idx < 0) {
            return;
        }
        this._hpHarvestRuns.splice(idx, 1);

        const node = run.node;
        const anim = node?.getComponent(Animation);
        anim?.off(Animation.EventType.FINISHED, run.onClipFinished, this);
        anim?.stop();

        if (node?.isValid) {
            node.destroy();
        }

        if (!cancelled) {
            run.onComplete();
        }
    }

    private _applyFlapSpeed(speed: number) {
        if (!this._flapState) {
            return;
        }
        this._flapState.speed = speed;
        if (speed <= 1e-5) {
            this._flapState.pause();
        } else {
            this._flapState.resume();
        }
    }
}
