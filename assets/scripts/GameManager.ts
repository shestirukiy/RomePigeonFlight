import {
    _decorator,
    Component,
    input,
    Input,
    EventMouse,
    EventTouch,
    Label,
    Node,
    UITransform,
    instantiate,
} from 'cc';
import { LevelGenerator } from './LevelGenerator';
import { PlayerFlight } from './PlayerFlight';
import { PlayerPathSensors } from './PlayerPathSensors';
import { SceneNodeHub } from './SceneNodeHub';

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

    private _score = 0;
    private _currentHp = 0;
    private _gameOver = false;
    private _damageInvincibleRemain = 0;

    /** Слева направо: [якорное сердечко, клоны справа]. */
    private readonly _heartNodes: Node[] = [];
    private readonly _spawnedHearts: Node[] = [];

    public get score(): number {
        return this._score;
    }

    public get currentHp(): number {
        return this._currentHp;
    }

    public get maxHp(): number {
        return this.maxHpCount;
    }

    public get isGameOver(): boolean {
        return this._gameOver;
    }

    public get isDamageInvincible(): boolean {
        return this._damageInvincibleRemain > 0;
    }

    public get isPlaying(): boolean {
        return this._playing && !this._gameOver;
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

    @property({
        type: Label,
        displayName: 'Score Label',
        tooltip: 'Label на Canvas, куда выводится счёт очков.',
    })
    scoreLabel: Label | null = null;

    @property({
        type: Node,
        displayName: 'HP Heart (anchor)',
        tooltip:
            'Первое сердечко в ряду HP (слева). Остальные клонируются вправо при старте.',
    })
    hpHeartAnchor: Node | null = null;

    @property({
        displayName: 'Max HP',
        tooltip: 'Сколько сердечек в ряду, включая якорное.',
    })
    maxHpCount = 3;

    @property({
        displayName: 'Heart spacing X',
        tooltip:
            'Доп. отступ между сердечками по X. Шаг = ширина UITransform якоря + это значение.',
    })
    heartSpacingX = 4;

    @property({
        type: Node,
        displayName: 'Game Over Panel',
        tooltip: 'Панель поражения; включается в gameOver().',
    })
    gameOverPanel: Node | null = null;

    @property({
        displayName: 'Damage invincibility (s)',
        tooltip:
            'После потери HP игрок не получает урон повторно, пока не истечёт таймер (одно препятствие / несколько контактов).',
    })
    damageInvincibilitySec = 0.85;

    onLoad() {
        GameManager._inst = this;
        this._refreshScoreLabel();
        this.resetHp();
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }
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
            this._damageInvincibleRemain = 0;
            return;
        }

        if (this._damageInvincibleRemain > 0) {
            this._damageInvincibleRemain = Math.max(
                0,
                this._damageInvincibleRemain - dt,
            );
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
        this._gameOver = false;
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }
        this._resetRunState();
        this._playing = true;
        this.resetScore();
        this.resetHp();
    }

    private _resetScrollAndKickback(): void {
        this._worldKickbackRemain = 0;
        this._worldKickbackSpeed = 0;
        this._forwardScrollBlockRef = 0;
        this._forwardScrollHoldRemain = 0;
        this._kickbackBackBlockRef = 0;
        this._kickbackBackHoldRemain = 0;
        this._damageInvincibleRemain = 0;
    }

    /** Позиция игрока, чанки, контакты — как в начале сцены. */
    private _resetRunState(): void {
        this._resetScrollAndKickback();

        this.getComponent(LevelGenerator)?.rebuildChunks();

        const player = SceneNodeHub.instance?.player;
        if (player) {
            player.getComponent(PlayerFlight)?.resetToSpawn();
            player.getComponent(PlayerPathSensors)?.resetForNewRun();
        }
    }

    public resetScore(): void {
        this._score = 0;
        this._refreshScoreLabel();
    }

    public addScore(delta = 1): void {
        if (delta <= 0 || !this.isPlaying) {
            return;
        }
        this._score += delta;
        this._refreshScoreLabel();
    }

    /** Восстанавливает ряд сердечек (якорь + клоны справа). */
    public resetHp(): void {
        this._clearSpawnedHearts();
        this._heartNodes.length = 0;
        this._currentHp = 0;

        const anchor = this.hpHeartAnchor;
        if (!anchor?.isValid || this.maxHpCount <= 0) {
            return;
        }

        const parent = anchor.parent;
        if (!parent) {
            return;
        }

        const base = anchor.position.clone();
        const step = this._heartStepX();
        anchor.active = true;
        this._heartNodes.push(anchor);

        for (let i = 1; i < this.maxHpCount; i++) {
            const heart = instantiate(anchor);
            heart.parent = parent;
            heart.setPosition(base.x + step * i, base.y, base.z);
            heart.active = true;
            this._spawnedHearts.push(heart);
            this._heartNodes.push(heart);
        }

        this._currentHp = this.maxHpCount;
        this._damageInvincibleRemain = 0;
    }

    /**
     * Урон: пропадает самое правое сердечко (включая клоны, затем якорь).
     * При 0 HP — {@link gameOver}.
     */
    public takeDamage(amount = 1): void {
        if (!this.isPlaying || amount <= 0) {
            return;
        }
        if (this._damageInvincibleRemain > 0) {
            return;
        }

        let lost = 0;
        for (let i = 0; i < amount; i++) {
            if (this._currentHp <= 0) {
                break;
            }
            const idx = this._currentHp - 1;
            const heart = this._heartNodes[idx];
            if (heart?.isValid) {
                heart.active = false;
            }
            this._currentHp--;
            lost++;
        }

        if (lost > 0 && this.damageInvincibilitySec > 0) {
            this._damageInvincibleRemain = this.damageInvincibilitySec;
        }

        if (this._currentHp <= 0) {
            this.gameOver();
        }
    }

    /**
     * Смертельное препятствие (нода Ground): сразу 0 HP и game over.
     * Игнорирует неуязвимость после обычного урона.
     */
    public instantKill(): void {
        if (!this.isPlaying || this._gameOver) {
            return;
        }
        for (const heart of this._heartNodes) {
            if (heart?.isValid) {
                heart.active = false;
            }
        }
        this._currentHp = 0;
        this._damageInvincibleRemain = 0;
        this.gameOver();
    }

    /** Конец забега — наполните позже (UI, рестарт и т.д.). */
    public gameOver(): void {
        if (this._gameOver) {
            return;
        }
        this._gameOver = true;
        this._playing = false;
        if (this.gameOverPanel) {
            this.gameOverPanel.active = true;
        }
    }

    private _clearSpawnedHearts(): void {
        for (const n of this._spawnedHearts) {
            if (n?.isValid) {
                n.destroy();
            }
        }
        this._spawnedHearts.length = 0;
    }

    private _heartStepX(): number {
        const ui = this.hpHeartAnchor?.getComponent(UITransform);
        const w = ui?.contentSize.width ?? 64;
        return w + this.heartSpacingX;
    }

    private _refreshScoreLabel(): void {
        if (!this.scoreLabel) {
            return;
        }
        this.scoreLabel.string = `${this._score}`;
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
