import {
    _decorator,
    Component,
    Animation,
    AnimationClip,
    AnimationState,
    WrapMode,
} from 'cc';
import { GameManager } from './GameManager';
import { PlayerFlight } from './PlayerFlight';

const { ccclass, property } = _decorator;

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
    flapSpeedPressed = 1.35;

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
    wingFlapInertiaDuration = 0.45;

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

    onLoad() {
        this._anim =
            this.getComponent(Animation) ??
            this.getComponentInChildren(Animation);
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;
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
        if (overlayDurationSec <= 0) {
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
        if (overlayDurationSec <= 0) {
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

    /** Рестарт забега: сброс стана / удара и снова клип полёта. */
    public resetForNewRun(): void {
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
        if (st) {
            st.wrapMode = WrapMode.Loop;
            st.speed = 1;
            st.resume();
        }
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
        const playing = GameManager.game?.isPlaying === true;
        if (!playing || !this._anim) {
            if (!playing) {
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
            if (this._surfaceRunActive && this.surfaceRunClip) {
                this._anim.play(this.surfaceRunClip.name);
            } else {
                this._resumeFlapPlayback();
            }
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
