import {
    _decorator,
    Button,
    Component,
    input,
    Input,
    EventMouse,
    EventTouch,
    Label,
    Node,
    Tween,
    UITransform,
    instantiate,
    tween,
} from 'cc';
import { LevelGenerator } from './LevelGenerator';
import { PlayerFlight } from './PlayerFlight';
import { PlayerPathSensors } from './PlayerPathSensors';
import { PlayerAnimationController } from './PlayerAnimationController';
import { SceneNodeHub } from './SceneNodeHub';
import { CameraShake } from './CameraShake';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';

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

    /** 0 HP в воздухе: идёт deathClip, скролл и ввод выкл, UI ещё нет. */
    private _dying = false;

    /** 0 HP, но сначала доигрывается клип урона (облако / стена). */
    private _awaitingDeathSequence = false;

    /** После game over пользователь уже тапнул — показана KTAPanel. */
    private _ktaPanelShown = false;

    private _playAgainButton: Button | null = null;

    /** После Play Again — игнорировать тап, пока палец/кнопка мыши не отпущены. */
    private _suppressTapToStart = false;

    private readonly _gameOverSeedRollCounter = { value: 0 };

    private _damageInvincibleRemain = 0;

    /** Сколько порогов seedsPerExtraLife уже выдали за этот забег. */
    private _seedLifeBonusesGranted = 0;

    /** Слева направо: [якорное сердечко, клоны справа]. */
    private readonly _heartNodes: Node[] = [];
    private readonly _spawnedHearts: Node[] = [];

    public get score(): number {
        return this._score;
    }

    public get currentHp(): number {
        return this._currentHp;
    }

    /** Текущее число слотов сердечек в ряду (растёт с бонусами за семечки). */
    public get maxHp(): number {
        return this._heartNodes.length;
    }

    public get isGameOver(): boolean {
        return this._gameOver;
    }

    public get isKtaPanelShown(): boolean {
        return this._ktaPanelShown;
    }

    public get isDamageInvincible(): boolean {
        return this._damageInvincibleRemain > 0;
    }

    public get isDying(): boolean {
        return this._dying;
    }

    /** Смертельный удар: HP уже 0, ждём окончания hazard-клипа. */
    public get isAwaitingDeathSequence(): boolean {
        return this._awaitingDeathSequence;
    }

    public get isPlaying(): boolean {
        return this._playing && !this._gameOver && !this._dying;
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
            !this.isPlaying ||
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
        if (!this.isPlaying || this._worldKickbackRemain <= 0) {
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
        displayName: 'Starting HP',
        tooltip:
            'Сердечек в начале забега (якорь + клоны). Верхнего лимита нет — за семечки ряд растёт.',
    })
    startingHpCount = 3;

    @property({
        displayName: 'Heart spacing X',
        tooltip:
            'Доп. отступ между сердечками по X. Шаг = ширина UITransform якоря + это значение.',
    })
    heartSpacingX = 4;

    @property({
        displayName: 'Seeds Per Extra Life',
        tooltip:
            'За каждые N собранных семечек за забег — +1 HP. 0 — бонус выключен.',
    })
    seedsPerExtraLife = 100;

    @property({
        type: Node,
        displayName: 'Game Over Panel',
        tooltip: 'Панель поражения; включается в gameOver().',
    })
    gameOverPanel: Node | null = null;

    @property({
        type: Node,
        displayName: 'KTA Panel',
        tooltip:
            'Показывается после тапа по Game Over Panel; Play Again возвращает к ожиданию тапа.',
    })
    ktaPanel: Node | null = null;

    @property({
        displayName: 'Seed Count Roll Duration (s)',
        tooltip:
            'За сколько секунд счётчик на game over дойдёт от 0 до фактического счёта.',
    })
    gameOverSeedCountRollDurationSec = 1.2;

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
        this._hideOverlayPanels();
        this._bindPlayAgainButton();
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
    }

    onDestroy() {
        this._stopGameOverSeedCountRoll();
        this._unbindPlayAgainButton();
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
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

    /**
     * Play Again: сброс уровня/игрока и ожидание тапа (как при первом входе в сцену).
     */
    public returnToTapToStart(): void {
        this._gameOver = false;
        this._dying = false;
        this._cancelDeferredDeathSequence();
        this._ktaPanelShown = false;
        this._playing = false;
        this._suppressTapToStart = true;
        this._hideOverlayPanels();
        this._resetRunState();
        this.resetScore();
        this.resetHp();
        SoundController.instance?.resetVariantRotation();
        SoundController.instance?.continueKtaMusicAfterPlayAgain();

        const player = SceneNodeHub.instance?.player;
        this._findPlayerAnimation(player)?.playWaitingStay();
    }

    /** Новый забег по тапу (первый вход или после returnToTapToStart). */
    public startNewRun(): void {
        if (this._playing) {
            return;
        }
        SoundController.instance?.playRunStartTap();
        this._gameOver = false;
        this._dying = false;
        this._cancelDeferredDeathSequence();
        this._ktaPanelShown = false;
        this._hideOverlayPanels();
        this._resetRunState();
        this._playing = true;
        this.resetScore();
        this.resetHp();
        SoundController.instance?.resetVariantRotation();
        SoundController.instance?.playMusicForNewRun();
    }

    private _hideOverlayPanels(): void {
        this._stopGameOverSeedCountRoll();
        if (this.gameOverPanel?.isValid) {
            this.gameOverPanel.active = false;
        }
        if (this.ktaPanel?.isValid) {
            this.ktaPanel.active = false;
        }
    }

    private _showOverlayPanel(panel: Node | null): void {
        if (!panel?.isValid) {
            return;
        }
        panel.setPosition(0, 0, 0);
        panel.active = true;
    }

    private _showKtaPanel(): void {
        this._ktaPanelShown = true;
        if (this.gameOverPanel?.isValid) {
            this.gameOverPanel.active = false;
        }
        this._showOverlayPanel(this.ktaPanel);
        SoundController.instance?.playMusicForKtaPanel(true);
    }

    private _bindPlayAgainButton(): void {
        const btnNode = this.ktaPanel?.getChildByName('PlayAgainBttn');
        const button = btnNode?.getComponent(Button) ?? null;
        if (!button) {
            return;
        }
        this._playAgainButton = button;
        button.node.on(Button.EventType.CLICK, this._onPlayAgainClick, this);
    }

    private _unbindPlayAgainButton(): void {
        if (!this._playAgainButton?.node?.isValid) {
            this._playAgainButton = null;
            return;
        }
        this._playAgainButton.node.off(
            Button.EventType.CLICK,
            this._onPlayAgainClick,
            this,
        );
        this._playAgainButton = null;
    }

    private _onPlayAgainClick(): void {
        if (this._dying || !this._gameOver || !this._ktaPanelShown) {
            return;
        }
        this.returnToTapToStart();
    }

    private _onMenuTap(): void {
        if (this._suppressTapToStart) {
            return;
        }
        if (this._dying) {
            return;
        }
        if (this._playing && !this._gameOver) {
            return;
        }
        if (this._gameOver) {
            if (!this._ktaPanelShown) {
                this._showKtaPanel();
            }
            return;
        }
        this.startNewRun();
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
            this._findPlayerAnimation(player)?.resetForNewRun();
        }
    }

    /** PlayerAnimationController висит на Pigeon, не на корне Player. */
    private _findPlayerAnimation(
        player: Node | null,
    ): PlayerAnimationController | null {
        if (!player?.isValid) {
            return null;
        }
        return (
            player.getComponent(PlayerAnimationController) ??
            player.getComponentInChildren(PlayerAnimationController)
        );
    }

    public resetScore(): void {
        this._score = 0;
        this._seedLifeBonusesGranted = 0;
        this._refreshScoreLabel();
    }

    public addScore(delta = 1): void {
        if (delta <= 0 || !this.isPlaying) {
            return;
        }
        this._score += delta;
        this._refreshScoreLabel();
        this._applySeedLifeBonuses();
    }

    /** Пороги семечек → +1 HP (см. seedsPerExtraLife). */
    private _applySeedLifeBonuses(): void {
        const per = this.seedsPerExtraLife;
        if (per <= 0) {
            return;
        }

        const milestones = Math.floor(this._score / per);
        while (this._seedLifeBonusesGranted < milestones) {
            this._seedLifeBonusesGranted++;
            this._tryGrantExtraLife();
        }
    }

    /** +1 HP: восстанавливает скрытое сердечко или добавляет новое справа. */
    private _tryGrantExtraLife(): boolean {
        if (this._currentHp < this._heartNodes.length) {
            const heart = this._heartNodes[this._currentHp];
            if (heart?.isValid) {
                heart.active = true;
            }
            this._currentHp++;
            return true;
        }

        const anchor = this.hpHeartAnchor;
        if (!anchor?.isValid) {
            return false;
        }
        const parent = anchor.parent;
        if (!parent) {
            return false;
        }

        const last = this._heartNodes[this._heartNodes.length - 1] ?? anchor;
        const p = last.position;
        const step = this._heartStepX();
        const heart = instantiate(anchor);
        heart.parent = parent;
        heart.setPosition(p.x + step, p.y, p.z);
        heart.active = true;
        this._spawnedHearts.push(heart);
        this._heartNodes.push(heart);
        this._currentHp++;
        return true;
    }

    /** Восстанавливает ряд сердечек (якорь + клоны справа). */
    public resetHp(): void {
        this._clearSpawnedHearts();
        this._heartNodes.length = 0;
        this._currentHp = 0;

        const anchor = this.hpHeartAnchor;
        const startHp = Math.max(0, Math.floor(this.startingHpCount));
        if (!anchor?.isValid || startHp <= 0) {
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

        for (let i = 1; i < startHp; i++) {
            const heart = instantiate(anchor);
            heart.parent = parent;
            heart.setPosition(base.x + step * i, base.y, base.z);
            heart.active = true;
            this._spawnedHearts.push(heart);
            this._heartNodes.push(heart);
        }

        this._currentHp = startHp;
        this._damageInvincibleRemain = 0;
    }

    /**
     * Урон: пропадает самое правое сердечко (включая клоны, затем якорь).
     * При 0 HP — {@link beginDeathSequence} (клип смерти), кроме {@link instantKill}.
     * @param deferDeathSequence true — 0 HP, но {@link beginDeathSequence} вызовет вызывающий после hazard-клипа.
     * @returns true, если HP стало 0.
     */
    public takeDamage(
        amount = 1,
        playDamageSound = true,
        deferDeathSequence = false,
    ): boolean {
        if (
            !this.isPlaying ||
            amount <= 0 ||
            this._awaitingDeathSequence ||
            this._dying
        ) {
            return false;
        }
        if (this._damageInvincibleRemain > 0) {
            return false;
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

        if (lost > 0) {
            if (playDamageSound) {
                SoundController.instance?.play(SoundId.Damage);
            }
            CameraShake.instance?.shakeOnDamage();
            if (this.damageInvincibilitySec > 0) {
                this._damageInvincibleRemain = this.damageInvincibilitySec;
            }
        }

        if (this._currentHp <= 0) {
            if (deferDeathSequence) {
                this._awaitingDeathSequence = true;
                return true;
            }
            this.beginDeathSequence();
            return true;
        }
        return false;
    }

    /**
     * После hazard-клипа при смертельном ударе — запуск {@link beginDeathSequence}.
     */
    public scheduleDeathAfterHazardAnimation(delaySec: number): void {
        if (!this._awaitingDeathSequence) {
            this.beginDeathSequence();
            return;
        }
        this.unschedule(this._onDeferredDeathSequence);
        this.scheduleOnce(
            this._onDeferredDeathSequence,
            Math.max(0.05, delaySec),
        );
    }

    private _onDeferredDeathSequence = (): void => {
        if (!this._awaitingDeathSequence || this._gameOver) {
            return;
        }
        this._awaitingDeathSequence = false;
        this.beginDeathSequence();
    };

    private _cancelDeferredDeathSequence(): void {
        this.unschedule(this._onDeferredDeathSequence);
        this._awaitingDeathSequence = false;
    }

    /**
     * 0 HP в воздухе: стоп скролла/ввода, deathClip, затем {@link gameOver}.
     */
    public beginDeathSequence(): void {
        if (this._dying || this._gameOver || !this._playing) {
            return;
        }
        this._cancelDeferredDeathSequence();
        this._dying = true;
        this._damageInvincibleRemain = 0;
        this.cancelWorldKickback();
        this._resetScrollAndKickback();

        const player = SceneNodeHub.instance?.player;
        player?.getComponent(PlayerFlight)?.releaseInput();

        const anim = this._findPlayerAnimation(player ?? null);
        const started =
            anim?.playDeath(() => {
                this._dying = false;
                this.gameOver();
            }) === true;
        if (!started) {
            this._dying = false;
            this.gameOver();
        }
    }

    /**
     * Касание Ground: птица уже «упала» — без deathClip, сразу game over.
     * Игнорирует неуязвимость после обычного урона.
     */
    public instantKill(): void {
        if (
            !this._playing ||
            this._gameOver ||
            this._dying ||
            this._awaitingDeathSequence
        ) {
            return;
        }
        for (const heart of this._heartNodes) {
            if (heart?.isValid) {
                heart.active = false;
            }
        }
        this._currentHp = 0;
        this._damageInvincibleRemain = 0;
        if (SoundController.instance?.library?.getClip(SoundId.InstantKill)) {
            SoundController.instance.play(SoundId.InstantKill);
        }
        this.gameOver();
    }

    /** Конец забега — наполните позже (UI, рестарт и т.д.). */
    public gameOver(): void {
        if (this._gameOver) {
            return;
        }
        this._cancelDeferredDeathSequence();
        this._dying = false;
        this._gameOver = true;
        this._playing = false;
        this._ktaPanelShown = false;
        this._hideOverlayPanels();
        SoundController.instance?.endKtaBgmPhase();
        SoundController.instance?.stopBgm();
        SoundController.instance?.play(SoundId.WallHit);
        SoundController.instance?.playGameOverJingle();
        this._findPlayerAnimation(SceneNodeHub.instance?.player ?? null)
            ?.freezeIdleFlightPose();
        this._showOverlayPanel(this.gameOverPanel);
        this._playGameOverSeedCountRoll(this._score);
    }

    private _playGameOverSeedCountRoll(targetScore: number): void {
        const label =
            SceneNodeHub.instance?.gameOverSeedScoreNode?.getComponent(Label);
        if (!label?.isValid) {
            return;
        }

        this._stopGameOverSeedCountRoll();

        const target = Math.max(0, Math.floor(targetScore));
        this._gameOverSeedRollCounter.value = 0;
        label.string = '0';

        if (target <= 0) {
            return;
        }

        const duration = Math.max(0.05, this.gameOverSeedCountRollDurationSec);
        tween(this._gameOverSeedRollCounter)
            .to(
                duration,
                { value: target },
                {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (label.isValid) {
                            label.string = `${Math.round(this._gameOverSeedRollCounter.value)}`;
                        }
                    },
                },
            )
            .call(() => {
                if (label.isValid) {
                    label.string = `${target}`;
                }
            })
            .start();
    }

    private _stopGameOverSeedCountRoll(): void {
        Tween.stopAllByTarget(this._gameOverSeedRollCounter);
        this._gameOverSeedRollCounter.value = 0;
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
        this._onMenuTap();
    }

    private _onTouchEnd(_e: EventTouch | EventMouse) {
        this._suppressTapToStart = false;
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._onMenuTap();
        }
    }

    private _onMouseUp(e: EventMouse) {
        if (e.getButton() === 0) {
            this._onTouchEnd(e);
        }
    }
}
