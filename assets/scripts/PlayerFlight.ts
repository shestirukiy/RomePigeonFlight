import {
    _decorator,
    Component,
    EventMouse,
    EventTouch,
    Input,
    RigidBody2D,
    ERigidBody2DType,
    Vec2,
    input,
} from 'cc';
import { GameManager } from './GameManager';

const { ccclass, property } = _decorator;

/**
 * Полёт голубя: гравитация через RigidBody2D, при удержании тапа/ЛКМ — подъём силой.
 * Затухание и масса настраиваются на самом Rigid Body 2D (Linear Damping и т.д.).
 * До старта игры (Game Manager) гравитация выключена, скорость обнуляется.
 */
@ccclass('PlayerFlight')
export class PlayerFlight extends Component {
    @property({
        tooltip:
            'Вертикальная сила при удержании ввода (подбирается под массу и гравитацию сцены).',
    })
    liftForce = 14000;

    @property({
        tooltip: 'Максимальная скорость вверх (ограничение по linearVelocity.y).',
    })
    maxUpSpeed = 520;

    @property({
        tooltip: 'Максимальная скорость падения по модулю.',
    })
    maxDownSpeed = 650;

    private _body: RigidBody2D | null = null;
    private _held = false;

    /** Для анимаций / UI: удерживается ли тап или ЛКМ. */
    public get isInputHeld(): boolean {
        return this._held;
    }

    /** Gravity Scale с компонента Rigid Body 2D из инспектора (не перезаписываем каждый кадр единицей). */
    private _savedGravityScale = 1;

    onLoad() {
        this._body = this.getComponent(RigidBody2D);
        if (this._body) {
            this._savedGravityScale = this._body.gravityScale;
            this._body.type = ERigidBody2DType.Dynamic;
            this._body.fixedRotation = true;
        }

        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
    }

    update(_dt: number) {
        const body = this._body;
        if (!body) {
            return;
        }

        const playing = GameManager.game?.isPlaying === true;
        if (!playing) {
            body.gravityScale = 0;
            body.linearVelocity = new Vec2(0, 0);
            return;
        }

        body.gravityScale = this._savedGravityScale;

        if (this._held) {
            body.applyForceToCenter(new Vec2(0, this.liftForce), true);
        }

        const v = body.linearVelocity;
        let vy = v.y;
        if (vy > this.maxUpSpeed) {
            vy = this.maxUpSpeed;
        } else if (vy < -this.maxDownSpeed) {
            vy = -this.maxDownSpeed;
        }
        // без горизонтальной инерции (только вертикаль)
        body.linearVelocity = new Vec2(0, vy);
    }

    private _onTouchStart(_e: EventTouch) {
        this._held = true;
    }

    private _onTouchEnd(_e: EventTouch) {
        this._held = false;
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._held = true;
        }
    }

    private _onMouseUp(e: EventMouse) {
        if (e.getButton() === 0) {
            this._held = false;
        }
    }
}
