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
 * Отдача от стены: через applyWorldKickback (как TowerWallHazard) — состояние меняется в колбэке контакта.
 * Стоп скролла вперёд: PlayerPathSensors вызывает syncPathSensorBlockCounts раз в кадр.
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

    /** Сколько активных «впереди стена» контактов сообщили сенсоры (BEGIN − END). */
    private _forwardScrollBlockRef = 0;

    /**
     * После любого BEGIN переднего сенсора держим стоп ещё min секунд (BEGIN+END в один кадр).
     */
    private _forwardScrollHoldRemain = 0;

    /** Для отскока: контакт заднего сенсора с твёрдой стеной. */
    private _kickbackBackBlockRef = 0;
    private _kickbackBackHoldRemain = 0;

    public get isPlaying(): boolean {
        return this._playing;
    }

    public get isWorldKickbackActive(): boolean {
        return this._worldKickbackRemain > 0;
    }

    /** Принудительно остановить отдачу (если отскок упёрся в другую преграду). */
    public cancelWorldKickback(): void {
        this._worldKickbackRemain = 0;
        this._worldKickbackSpeed = 0;
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

    /**
     * Вызывать из колбэка BEGIN_CONTACT переднего сенсора (как TowerWall дергает applyWorldKickback).
     */
    public addForwardScrollBlock(): void {
        if (!this._playing) {
            return;
        }
        this._forwardScrollBlockRef++;
        this._forwardScrollHoldRemain = Math.max(
            this._forwardScrollHoldRemain,
            this.forwardContactMinHoldSec,
        );
    }

    /** Вызывать из END_CONTACT переднего сенсора. */
    public removeForwardScrollBlock(): void {
        this._forwardScrollBlockRef = Math.max(0, this._forwardScrollBlockRef - 1);
        // Как только все контакты сняты — сразу убираем искусственный hold, скролл возобновляется.
        if (this._forwardScrollBlockRef <= 0) {
            this._forwardScrollBlockRef = 0;
            this._forwardScrollHoldRemain = 0;
        }
    }

    /**
     * Раз в кадр из PlayerPathSensors после prune: выставляет блокировки по фактическому числу
     * активных препятствий. Лечит рассинхрон инкрементов BEGIN/END и ложные prune.
     */
    public syncPathSensorBlockCounts(
        frontBlockingCount: number,
        backBlockingCount: number,
    ): void {
        if (!this._playing) {
            return;
        }
        this._forwardScrollBlockRef = Math.max(0, frontBlockingCount);
        this._kickbackBackBlockRef = Math.max(0, backBlockingCount);
        if (this._forwardScrollBlockRef > 0) {
            this._forwardScrollHoldRemain = Math.max(
                this._forwardScrollHoldRemain,
                this.forwardContactMinHoldSec,
            );
        } else {
            this._forwardScrollHoldRemain = 0;
        }
        if (this._kickbackBackBlockRef > 0) {
            this._kickbackBackHoldRemain = Math.max(
                this._kickbackBackHoldRemain,
                this.backContactMinHoldSec,
            );
        } else {
            this._kickbackBackHoldRemain = 0;
        }
    }

    public addKickbackBackBlock(): void {
        if (!this._playing) {
            return;
        }
        this._kickbackBackBlockRef++;
        this._kickbackBackHoldRemain = Math.max(
            this._kickbackBackHoldRemain,
            this.backContactMinHoldSec,
        );
    }

    public removeKickbackBackBlock(): void {
        this._kickbackBackBlockRef = Math.max(0, this._kickbackBackBlockRef - 1);
        if (this._kickbackBackBlockRef <= 0) {
            this._kickbackBackBlockRef = 0;
            this._kickbackBackHoldRemain = 0;
        }
    }

    /** Сдвиг чанков «вперёд по забегу» (влево), без отдачи. Во время отдачи — 0. */
    public getForwardScrollDelta(_dt: number): number {
        if (
            !this._playing ||
            this._worldKickbackRemain > 0 ||
            this._forwardScrollBlockRef > 0 ||
            this._forwardScrollHoldRemain > 0
        ) {
            return 0;
        }
        return this.scrollSpeed * _dt;
    }

    /** Доп. сдвиг чанков вправо за кадр (отдача от стены). */
    public getWorldKickbackDelta(dt: number): number {
        if (!this._playing || this._worldKickbackRemain <= 0) {
            return 0;
        }
        if (
            this._kickbackBackBlockRef > 0 ||
            this._kickbackBackHoldRemain > 0
        ) {
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

    @property({
        displayName: 'Forward contact min hold (s)',
        tooltip:
            'Пока есть хотя бы один контакт, скролл остановлен. После последнего END hold сбрасывается сразу; это значение используется только если BEGIN был без пары END в том же кадре (редкий глитч физики).',
    })
    forwardContactMinHoldSec = 0.05;

    @property({
        displayName: 'Back contact min hold (s)',
        tooltip: 'То же для заднего сенсора во время отскока.',
    })
    backContactMinHoldSec = 0.05;

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
            this._forwardScrollBlockRef = 0;
            this._forwardScrollHoldRemain = 0;
            this._kickbackBackBlockRef = 0;
            this._kickbackBackHoldRemain = 0;
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

        if (this._forwardScrollBlockRef <= 0 && this._forwardScrollHoldRemain > 0) {
            this._forwardScrollHoldRemain = Math.max(
                0,
                this._forwardScrollHoldRemain - dt,
            );
        }

        if (this._kickbackBackBlockRef <= 0 && this._kickbackBackHoldRemain > 0) {
            this._kickbackBackHoldRemain = Math.max(
                0,
                this._kickbackBackHoldRemain - dt,
            );
        }

        if (
            this._worldKickbackRemain > 0 &&
            (this._kickbackBackBlockRef > 0 || this._kickbackBackHoldRemain > 0)
        ) {
            this.cancelWorldKickback();
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
