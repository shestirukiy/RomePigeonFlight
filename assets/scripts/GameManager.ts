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
 * First tap starts the run; scrollSpeed drives LevelGenerator chunk movement.
 * Отдача от стены: горизонтально двигается только мир (чанки вправо), узел игрока по X не трогаем.
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _inst: GameManager | null = null;

    public static get game(): GameManager | null {
        return GameManager._inst;
    }

    private _playing = false;

    /** Оставшееся время отдачи мира назад (чанки едут вправо). */
    private _worldKickbackRemain = 0;

    /** Скорость сдвига чанков вправо (пикс/с), пока идёт отдача. */
    private _worldKickbackSpeed = 0;

    public get isPlaying(): boolean {
        return this._playing;
    }

    public get isWorldKickbackActive(): boolean {
        return this._worldKickbackRemain > 0;
    }

    /**
     * Удар о стену: «вперёд» по скроллу не идём, чанки смещаются вправо на заданной скорости заданное время.
     */
    public applyWorldKickback(durationSec: number, kickbackPxPerSec: number): void {
        if (durationSec <= 0) {
            return;
        }
        this._worldKickbackRemain = Math.max(
            this._worldKickbackRemain,
            durationSec,
        );
        this._worldKickbackSpeed = Math.max(
            this._worldKickbackSpeed,
            Math.abs(kickbackPxPerSec),
        );
    }

    /** Сдвиг чанков «вперёд по забегу» (влево), без отдачи. Во время отдачи — 0. */
    public getForwardScrollDelta(dt: number): number {
        if (!this._playing || this._worldKickbackRemain > 0) {
            return 0;
        }
        return this.scrollSpeed * dt;
    }

    /** Доп. сдвиг чанков вправо за кадр (отдача от стены). */
    public getWorldKickbackDelta(dt: number): number {
        if (!this._playing || this._worldKickbackRemain <= 0) {
            return 0;
        }
        return this._worldKickbackSpeed * dt;
    }

    @property({
        displayName: 'Scroll Speed',
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

    update(dt: number) {
        if (!this._playing) {
            this._worldKickbackRemain = 0;
            this._worldKickbackSpeed = 0;
            return;
        }
        if (this._worldKickbackRemain > 0) {
            this._worldKickbackRemain = Math.max(
                0,
                this._worldKickbackRemain - dt,
            );
            if (this._worldKickbackRemain <= 0) {
                this._worldKickbackSpeed = 0;
            }
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
