import {
    _decorator,
    Component,
    Animation,
    AnimationClip,
    AnimationState,
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
        tooltip:
            'Зацикленный клип хлопанья крыльями. Укажите тот же клип в массиве Clips компонента Animation.',
    })
    flapClip: AnimationClip | null = null;

    @property({
        tooltip:
            'Скорость воспроизведения клипа при удержании экрана (быстрое хлопанье).',
    })
    flapSpeedPressed = 1.35;

    @property({
        tooltip:
            'Секунды после отпускания: скорость хлопанья линейно падает до нуля (инерция крыльев).',
    })
    wingFlapInertiaDuration = 0.45;

    private _anim: Animation | null = null;
    private _flapState: AnimationState | null = null;
    private _flight: PlayerFlight | null = null;

    private _flapSpeed = 0;

    /** Оставшееся время фазы затухания после отпускания. */
    private _tailTimeLeft = 0;

    /** С какой скорости клипа начали затухание. */
    private _speedAtTailStart = 0;

    private _wasHeld = false;

    onLoad() {
        this._anim =
            this.getComponent(Animation) ??
            this.getComponentInChildren(Animation);
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;
    }

    update(dt: number) {
        const playing = GameManager.game?.isPlaying === true;
        if (!playing || !this.flapClip || !this._anim) {
            this._applyFlapSpeed(0);
            this._tailTimeLeft = 0;
            this._wasHeld = false;
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
                this._flapSpeed = 0;
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
