import {
    _decorator,
    Component,
    input,
    Input,
    EventMouse,
    EventTouch,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Гейм-менеджер: первый тап/клик запускает игру; скорость мира для чанков (Level Generator).
 * Управление голубем — компонент Player Flight на игроке (Rigid Body 2D + гравитация).
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _inst: GameManager | null = null;

    public static get game(): GameManager | null {
        return GameManager._inst;
    }

    private _playing = false;

    public get isPlaying(): boolean {
        return this._playing;
    }

    @property({
        tooltip:
            'Скорость «мира» (пикс/с): использует Level Generator для сдвига чанков после старта игры.',
    })
    scrollSpeed = 280;

    onLoad() {
        GameManager._inst = this;
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        if (GameManager._inst === this) {
            GameManager._inst = null;
        }
    }

    private _tryStart() {
        if (this._playing) {
            return;
        }
        this._playing = true;
    }

    private _onTouchStart(_e: EventTouch) {
        this._tryStart();
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._tryStart();
        }
    }
}
