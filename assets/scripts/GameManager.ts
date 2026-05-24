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
    Prefab,
    Tween,
    UITransform,
    Vec3,
    instantiate,
    tween,
    ParticleSystem2D,
} from 'cc';
import { LevelGenerator } from './LevelGenerator';
import { PlayerFlight } from './PlayerFlight';
import { PlayerPathSensors } from './PlayerPathSensors';
import { PlayerAnimationController } from './PlayerAnimationController';
import { SceneNodeHub } from './SceneNodeHub';
import { CameraShake } from './CameraShake';
import { GameIntroController } from './GameIntroController';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';

const { ccclass, property, executionOrder } = _decorator;

const G_SCROLL = { id: 'Scroll', name: 'Scrolling' };
const G_MILESTONE = { id: 'Milestones', name: 'Milestone signs' };
const G_UI = { id: 'UI', name: 'UI' };
const G_HP = { id: 'Health', name: 'Health & seeds' };
const G_COMBAT = { id: 'Combat', name: 'Combat' };

/**
 * First tap starts the run; scrollSpeed drives LevelGenerator chunk movement.
 * Отдача от стены: через applyWorldKickback (как TowerWallHazard) — состояние меняется в колбэке контакта.
 * Стоп скролла вперёд: PlayerPathSensors вызывает syncPathSensorBlockCounts раз в кадр.
 */
@ccclass('GameManager')
@executionOrder(-95)
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

    /** 0…1 — разгон скролла после стопа (smoothstep). */
    private _forwardScrollEase01 = 0;

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

    /** Пройденная дистанция забега (пиксели сдвига мира вперёд). */
    private _flightDistancePx = 0;

    /** Следующий порог вехи в метрах (кумулятивно: 50, 100, 175, …). */
    private _nextMilestoneMeters = 0;

    /** Индекс для gap(k) при постановке следующего столба в очередь. */
    private _milestoneGapIndex = 0;

    private _milestonesPassedCount = 0;

    private _lastCompletedMilestoneMeters = 0;

    /** Вехи, для которых уже поставлен в очередь Chunk_Sign, но ещё не пройдены. */
    private readonly _activeMilestoneSigns = new Set<number>();

    /** Доп. множитель скорости после прохождения столба (1 = только milestoneSpeedMultiplier). */
    private _milestonePassBoostFactor = 1;
    private _milestonePassBoostHoldRemain = 0;
    private _milestonePassBoostSettleRemain = 0;

    /** Эмиттер Speed Lines (не active ноды — только enabled + stop/reset). */
    private _speedLinesEmitterOn = false;

    /** Слева направо: [якорное сердечко, клоны справа]. */
    private readonly _heartNodes: Node[] = [];
    private readonly _spawnedHearts: Node[] = [];

    public get score(): number {
        return this._score;
    }

    public get lastCompletedMilestoneMeters(): number {
        return this._lastCompletedMilestoneMeters;
    }

    public get milestonesPassedCount(): number {
        return this._milestonesPassedCount;
    }

    public get flightDistanceMeters(): number {
        const ppm = this.pixelsPerMeter;
        if (ppm <= 0) {
            return 0;
        }
        return this._flightDistancePx / ppm;
    }

    public get flightDistancePx(): number {
        return this._flightDistancePx;
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
        }
        /* ref=0: hold не обнуляем — в update() он плавно затухает, чтобы не дёргать камеру 1 кадр. */
        if (this._kickbackBackBlockRef > 0) {
            this._kickbackBackHoldRemain = Math.max(
                this._kickbackBackHoldRemain,
                this.backContactMinHoldSec,
            );
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

    private static _smoothstep01(t: number): number {
        const x = Math.min(1, Math.max(0, t));
        return x * x * (3 - 2 * x);
    }

    private _isForwardScrollHalted(): boolean {
        if (!this.isPlaying || this._worldKickbackRemain > 0) {
            return true;
        }
        if (
            this._forwardScrollBlockRef > 0 ||
            this._forwardScrollHoldRemain > 0
        ) {
            return true;
        }
        return this._playerPathSensors()?.shouldHoldForwardScroll() === true;
    }

    /** Разгон мира после старта / снятия блокировки (forwardScrollEaseInSec). */
    private _tickForwardScrollEase(dt: number): void {
        if (this._isForwardScrollHalted()) {
            this._forwardScrollEase01 = 0;
            return;
        }
        const dur = this.forwardScrollEaseInSec;
        if (dur <= 0) {
            this._forwardScrollEase01 = 1;
            return;
        }
        this._forwardScrollEase01 = Math.min(
            1,
            this._forwardScrollEase01 + dt / dur,
        );
    }

    /** Сдвиг чанков «вперёд по забегу» (влево), без отдачи. Во время отдачи — 0. */
    public getForwardScrollDelta(_dt: number): number {
        if (this._isForwardScrollHalted()) {
            return 0;
        }
        const ease = GameManager._smoothstep01(this._forwardScrollEase01);
        return this.getEffectiveScrollSpeed() * _dt * ease;
    }

    private _playerPathSensors(): PlayerPathSensors | null {
        const player = SceneNodeHub.instance?.player;
        if (!player?.isValid) {
            return null;
        }
        return (
            player.getComponent(PlayerPathSensors) ??
            player.getComponentInChildren(PlayerPathSensors)
        );
    }

    /** Скорость мира: scrollSpeed × вехи × кратковременный буст после столба. */
    public getEffectiveScrollSpeed(): number {
        const base = Math.max(0, this.scrollSpeed);
        return (
            base *
            this._getMilestoneSpeedMultiplier() *
            this._milestonePassBoostFactor
        );
    }

    /**
     * Множитель скорости мира относительно базового scrollSpeed (вехи × pass boost).
     */
    public getWorldScrollSpeedFactor(): number {
        const base = Math.max(1e-6, this.scrollSpeed);
        if (!this.isPlaying) {
            return 1;
        }
        return this.getEffectiveScrollSpeed() / base;
    }

    /**
     * Только постоянный прирост от пройденных вех (milestoneSpeedMultiplier^N), без Pass Boost.
     */
    public getMilestoneScrollSpeedFactor(): number {
        if (!this.isPlaying) {
            return 1;
        }
        return Math.max(1, this._getMilestoneSpeedMultiplier());
    }

    /**
     * Видимая скорость слоя препятствий (Plane 1): вехи × plane1ParallaxFactor, без Pass Boost.
     * Для сопоставления с PlayerFlight — тот же горизонт, что у чанков под игроком.
     */
    public getFlightScrollSpeedFactor(): number {
        if (!this.isPlaying) {
            return 1;
        }
        const levelGen = this.getComponent(LevelGenerator);
        const parallax = Math.max(0, levelGen?.plane1ParallaxFactor ?? 1);
        return Math.max(1, this._getMilestoneSpeedMultiplier() * parallax);
    }

    /** Pass Boost после столба (hold + плавный settle). */
    public isMilestonePassBoostActive(): boolean {
        if (!this._playing || !this.milestonePassBoostEnabled) {
            return false;
        }
        return (
            this._milestonePassBoostHoldRemain > 0 ||
            this._milestonePassBoostSettleRemain > 0
        );
    }

    private _getMilestoneSpeedMultiplier(): number {
        if (this._milestonesPassedCount <= 0) {
            return 1;
        }
        return Math.pow(
            this.milestoneSpeedMultiplier,
            this._milestonesPassedCount,
        );
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
        group: G_SCROLL,
        displayName: 'Scroll Speed',
        tooltip:
            'Скорость «мира» (пикс/с): использует Level Generator для сдвига чанков после старта игры.',
    })
    scrollSpeed = 280;

    @property({
        group: G_SCROLL,
        displayName: 'Forward contact min hold (s)',
        tooltip:
            'Пока есть хотя бы один контакт, скролл остановлен. После последнего END hold сбрасывается сразу; это значение используется только если BEGIN был без пары END в том же кадре (редкий глитч физики).',
    })
    forwardContactMinHoldSec = 0.05;

    @property({
        group: G_SCROLL,
        displayName: 'Back contact min hold (s)',
        tooltip: 'То же для заднего сенсора во время отскока.',
    })
    backContactMinHoldSec = 0.05;

    @property({
        group: G_SCROLL,
        displayName: 'Forward scroll ease-in (s)',
        tooltip:
            'Плавный разгон мира после старта забега и после каждой остановки (стена, отдача). 0 — без изинга.',
    })
    forwardScrollEaseInSec = 0.35;

    @property({
        group: G_MILESTONE,
        displayName: 'Pixels Per Meter',
        tooltip:
            'Сколько пикселей прокрутки слоя препятствий (Plane 1 × parallax) = 1 м на столбе. ' +
            'Слишком большое значение — долго до первой вехи.',
    })
    pixelsPerMeter = 150;

    @property({
        group: G_MILESTONE,
        displayName: 'First Milestone (m)',
        tooltip:
            'Первый столб на этой дистанции (50 — ранний «win»). 0 — вехи выкл.',
    })
    firstMilestoneMeters = 50;

    @property({
        group: G_MILESTONE,
        displayName: 'Milestone Gap Base (m)',
        tooltip:
            'Базовый зазор до следующего порога: gap(0) = base (второй столб ≈ first + base).',
    })
    milestoneGapBase = 50;

    @property({
        group: G_MILESTONE,
        displayName: 'Milestone Gap Growth (m)',
        tooltip:
            'Прирост зазора: gap(k) = base + growth × k^exp. Без потолка — дальше столбы реже.',
    })
    milestoneGapGrowth = 35;

    @property({
        group: G_MILESTONE,
        displayName: 'Milestone Gap Exponent',
        tooltip:
            'Степень роста зазора: gap(k) = base + growth × k^exp. ' +
            'exp > 1 — поздние вехи заметно реже (1 = линейно).',
    })
    milestoneGapExponent = 1.35;

    @property({
        group: G_MILESTONE,
        displayName: 'Milestone Speed Multiplier',
        tooltip:
            'Множитель скорости за каждую пройденную веху (×1.05 → +5% к scrollSpeed). ' +
            'Без потолка: скорость растёт, пока игрок не упрётся в свою реакцию.',
    })
    milestoneSpeedMultiplier = 1.05;

    @property({
        group: G_MILESTONE,
        displayName: 'Milestone Round Step (m)',
        tooltip:
            'Пороги и цифры на столбах — только кратные этому шагу (50 → 50, 100, 150… 700, 750). 0 — без округления.',
    })
    milestoneRoundStep = 50;

    @property({
        group: G_MILESTONE,
        displayName: 'Pass Boost Enabled',
        tooltip:
            'После прохождения столба: краткий рывок скорости, затем плавный возврат к обычному множителю вехи.',
    })
    milestonePassBoostEnabled = true;

    @property({
        group: G_MILESTONE,
        displayName: 'Pass Boost Multiplier',
        tooltip: 'Во время рывка: скорость × этот множитель (поверх множителя вехи).',
        visible() {
            return (this as GameManager).milestonePassBoostEnabled;
        },
    })
    milestonePassBoostMultiplier = 2;

    @property({
        group: G_MILESTONE,
        displayName: 'Pass Boost Hold (s)',
        tooltip: 'Сколько секунд держать пиковый множитель перед плавным спадом.',
        visible() {
            return (this as GameManager).milestonePassBoostEnabled;
        },
    })
    milestonePassBoostHoldSec = 1;

    @property({
        group: G_MILESTONE,
        displayName: 'Pass Boost Settle (s)',
        tooltip: 'Длительность плавного снижения с пика до обычной скорости вехи.',
        visible() {
            return (this as GameManager).milestonePassBoostEnabled;
        },
    })
    milestonePassBoostSettleSec = 0.85;

    @property({
        group: G_UI,
        type: Label,
        displayName: 'Score Label',
        tooltip: 'Label на Canvas, куда выводится счёт очков.',
    })
    scoreLabel: Label | null = null;

    @property({
        group: G_UI,
        type: Node,
        displayName: 'Game Over Panel',
        tooltip: 'Панель поражения; включается в gameOver().',
    })
    gameOverPanel: Node | null = null;

    @property({
        group: G_UI,
        type: Node,
        displayName: 'KTA Panel',
        tooltip:
            'Показывается после тапа по Game Over Panel; Play Again возвращает к ожиданию тапа.',
    })
    ktaPanel: Node | null = null;

    @property({
        group: G_UI,
        displayName: 'Seed Count Roll Duration (s)',
        tooltip:
            'За сколько секунд счётчик на game over дойдёт от 0 до фактического счёта.',
    })
    gameOverSeedCountRollDurationSec = 1.2;

    @property({
        group: G_HP,
        type: Node,
        displayName: 'HP Heart (anchor)',
        tooltip:
            'Первое сердечко в ряду HP (слева). Остальные клонируются вправо при старте.',
    })
    hpHeartAnchor: Node | null = null;

    @property({
        group: G_HP,
        displayName: 'Starting HP',
        tooltip:
            'Сердечек в начале забега (якорь + клоны). Верхнего лимита нет — за семечки ряд растёт.',
    })
    startingHpCount = 3;

    @property({
        group: G_HP,
        displayName: 'Heart spacing X',
        tooltip:
            'Доп. отступ между сердечками по X. Шаг = ширина UITransform якоря + это значение.',
    })
    heartSpacingX = 4;

    @property({
        group: G_HP,
        displayName: 'Seeds Per Extra Life',
        tooltip:
            'За каждые N собранных семечек за забег — +1 HP. 0 — бонус выключен.',
    })
    seedsPerExtraLife = 100;

    @property({
        group: G_COMBAT,
        displayName: 'Damage invincibility (s)',
        tooltip:
            'После потери HP игрок не получает урон повторно, пока не истечёт таймер (одно препятствие / несколько контактов).',
    })
    damageInvincibilitySec = 0.85;

    @property({
        group: G_COMBAT,
        type: Prefab,
        displayName: 'Damage Particle FX Prefab',
        tooltip: 'Префаб DamageParticleFX — спавн при потере HP (рядом с игроком).',
    })
    damageParticleFxPrefab: Prefab | null = null;

    @property({
        group: G_COMBAT,
        displayName: 'Damage FX Local Offset',
        tooltip: 'Смещение всплеска перьев относительно корня Player (как на старом DamageParticle).',
    })
    damageParticleLocalOffset = new Vec3(24.684, -8.364, 0);

    onLoad() {
        GameManager._inst = this;
        if (!this.getComponent(GameIntroController)) {
            this.addComponent(GameIntroController);
        }
        this._setSpeedLinesEmitter(false);
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
            this._forwardScrollEase01 = 0;
            this._kickbackBackBlockRef = 0;
            this._kickbackBackHoldRemain = 0;
            this._damageInvincibleRemain = 0;
            this._syncSpeedLinesEmitter();
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

        this._tickForwardScrollEase(dt);
        this._tickMilestonePassBoost(dt);
        this._syncSpeedLinesEmitter();
        this._tickFlightDistanceAndMilestones(dt);
    }

    private _tickFlightDistanceAndMilestones(dt: number): void {
        if (!this.isPlaying) {
            return;
        }
        const delta = this.getForwardScrollDelta(dt);
        if (delta <= 0) {
            return;
        }
        const levelGen = this.getComponent(LevelGenerator);
        const scrollFactor = Math.max(0, levelGen?.plane1ParallaxFactor ?? 1);
        this._flightDistancePx += delta * scrollFactor;

        const first = this.firstMilestoneMeters;
        const ppm = this.pixelsPerMeter;
        if (first <= 0 || ppm <= 0) {
            return;
        }

        let queuedAny = false;
        while (this._flightDistancePx >= this._nextMilestoneMeters * ppm) {
            const m = this._nextMilestoneMeters;
            this._activeMilestoneSigns.add(m);
            levelGen?.queueMilestoneChunk(m);
            queuedAny = true;
            const gap = this._computeMilestoneGap(this._milestoneGapIndex);
            this._milestoneGapIndex++;
            this._nextMilestoneMeters = this._snapMilestoneMeters(m + gap, m);
        }
        if (queuedAny) {
            levelGen?.flushMilestoneSpawnIfReady();
        }
    }

    /**
     * «Круглые» метры на столбе: 700, 750, не 731. Следующий порог строго больше предыдущего.
     */
    private _snapMilestoneMeters(raw: number, afterMeters: number): number {
        const step = this.milestoneRoundStep;
        let m = Math.max(0, Math.floor(raw));
        if (step > 0) {
            m = Math.round(m / step) * step;
            if (m <= afterMeters) {
                m = afterMeters + step;
            }
        }
        return Math.max(0, m);
    }

    /** Зазор до следующего порога (м): base + growth × k^exp (без потолка). */
    private _computeMilestoneGap(gapIndex: number): number {
        const base = Math.max(0, this.milestoneGapBase);
        const growth = Math.max(0, this.milestoneGapGrowth);
        const exp = Math.max(1, this.milestoneGapExponent);
        const k = Math.max(0, gapIndex);
        return base + growth * Math.pow(k, exp);
    }

    /**
     * Прохождение столба-вехи (MilestoneSign). Возвращает true, если веха принята.
     */
    public onMilestoneSignPassed(meters: number): boolean {
        if (!this.isPlaying) {
            return false;
        }
        const m = Math.max(0, Math.floor(meters));
        if (!this._activeMilestoneSigns.has(m)) {
            return false;
        }
        this._activeMilestoneSigns.delete(m);
        this._milestonesPassedCount++;
        this._lastCompletedMilestoneMeters = m;
        SoundController.instance?.playMilestonePassed();
        SceneNodeHub.instance?.showMetersPassed(m);
        this._triggerMilestonePassBoost();
        return true;
    }

    private _triggerMilestonePassBoost(): void {
        if (!this.milestonePassBoostEnabled) {
            return;
        }
        SoundController.instance?.playSpeedBoost();
        const peak = Math.max(1, this.milestonePassBoostMultiplier);
        this._milestonePassBoostFactor = peak;
        this._milestonePassBoostHoldRemain = Math.max(
            0,
            this.milestonePassBoostHoldSec,
        );
        this._milestonePassBoostSettleRemain = 0;
    }

    private _tickMilestonePassBoost(dt: number): void {
        if (!this.milestonePassBoostEnabled || !this.isPlaying) {
            this._resetMilestonePassBoost();
            return;
        }

        const peak = Math.max(1, this.milestonePassBoostMultiplier);
        const settleDur = Math.max(0, this.milestonePassBoostSettleSec);

        if (this._milestonePassBoostHoldRemain > 0) {
            this._milestonePassBoostHoldRemain = Math.max(
                0,
                this._milestonePassBoostHoldRemain - dt,
            );
            this._milestonePassBoostFactor = peak;
            if (this._milestonePassBoostHoldRemain <= 0 && settleDur > 0) {
                this._milestonePassBoostSettleRemain = settleDur;
            } else if (this._milestonePassBoostHoldRemain <= 0) {
                this._milestonePassBoostFactor = 1;
            }
            return;
        }

        if (this._milestonePassBoostSettleRemain > 0) {
            this._milestonePassBoostSettleRemain = Math.max(
                0,
                this._milestonePassBoostSettleRemain - dt,
            );
            const t =
                settleDur > 0
                    ? 1 - this._milestonePassBoostSettleRemain / settleDur
                    : 1;
            const eased = t * t * (3 - 2 * t);
            this._milestonePassBoostFactor = peak + (1 - peak) * eased;
            if (this._milestonePassBoostSettleRemain <= 0) {
                this._milestonePassBoostFactor = 1;
            }
            return;
        }

        this._milestonePassBoostFactor = 1;
    }

    private _resetMilestonePassBoost(): void {
        this._milestonePassBoostFactor = 1;
        this._milestonePassBoostHoldRemain = 0;
        this._milestonePassBoostSettleRemain = 0;
        this._syncSpeedLinesEmitter();
    }

    private _syncSpeedLinesEmitter(): void {
        const want = this.isMilestonePassBoostActive();
        if (want === this._speedLinesEmitterOn) {
            return;
        }
        this._speedLinesEmitterOn = want;
        this._setSpeedLinesEmitter(want);
    }

    /**
     * Эмиттер: вкл — resetSystem (новые частицы).
     * Выкл — stopSystem (новые не рождаются, живые доигрывают life).
     * Ноду и компонент не выключаем — иначе всё пропадает мгновенно.
     */
    private _setSpeedLinesEmitter(on: boolean): void {
        const ps = SceneNodeHub.instance?.speedLinesEmitter;
        if (!ps?.isValid) {
            return;
        }
        if (!ps.enabled) {
            ps.enabled = true;
        }
        if (on) {
            ps.resetSystem();
            return;
        }
        ps.stopSystem();
    }

    private _resetMilestones(): void {
        this._flightDistancePx = 0;
        this._nextMilestoneMeters = this._snapMilestoneMeters(
            this.firstMilestoneMeters,
            0,
        );
        this._milestoneGapIndex = 0;
        this._milestonesPassedCount = 0;
        this._lastCompletedMilestoneMeters = 0;
        this._activeMilestoneSigns.clear();
        this._resetMilestonePassBoost();
        this.getComponent(LevelGenerator)?.clearMilestoneQueue();
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
        GameIntroController.skipIntroAfterRestart();
        GameIntroController.instance?.snapToGameplayCamera();
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

    /**
     * Нельзя включать panel.active внутри BEGIN_CONTACT — у детей RigidBody2D падает b2World.
     */
    private _showOverlayPanelDeferred(panel: Node | null): void {
        if (!panel?.isValid) {
            return;
        }
        this.scheduleOnce(() => {
            if (panel.isValid) {
                this._showOverlayPanel(panel);
            }
        }, 0);
    }

    private _showKtaPanel(): void {
        this._ktaPanelShown = true;
        if (this.gameOverPanel?.isValid) {
            this.gameOverPanel.active = false;
        }
        this._hideWorldChunkContainers();
        this._showOverlayPanelDeferred(this.ktaPanel);
        SoundController.instance?.playMusicForKtaPanel(true);
    }

    /** Сразу скрыть контейнеры мира (Obstacles / Town / Sky), не по одному чанку. */
    private _hideWorldChunkContainers(): void {
        const gen = this.getComponent(LevelGenerator);
        gen?.setAllChunkLayersActive(false);
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
        if (GameIntroController.instance?.tryConsumeIntroTap()) {
            return;
        }
        if (GameIntroController.instance?.isBlockingInput) {
            return;
        }
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
        this._forwardScrollEase01 = 0;
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
        this._resetMilestones();
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
            if (this._tryGrantExtraLife()) {
                SceneNodeHub.instance?.showLifeRestored();
            }
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
            this._playDamageParticleOnPlayer();
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

    private static readonly DAMAGE_PARTICLE_CHILD = 'DamageParticle';

    private _embeddedDamageParticleHideRemain = 0;

    private _playDamageParticleOnPlayer(): void {
        const player = this._resolvePlayerNode();
        if (!player?.isValid) {
            return;
        }

        const embedded = player.getChildByName(
            GameManager.DAMAGE_PARTICLE_CHILD,
        );
        const psEmbedded = embedded?.getComponent(ParticleSystem2D);
        if (embedded?.isValid && psEmbedded) {
            this._burstDamageParticle(embedded, psEmbedded, true);
            return;
        }

        const prefab = this.damageParticleFxPrefab;
        if (!prefab) {
            return;
        }

        const fx = instantiate(prefab);
        if (!fx?.isValid) {
            return;
        }

        fx.active = true;
        fx.layer = player.layer;
        player.addChild(fx);
        const off = this.damageParticleLocalOffset;
        fx.setPosition(off.x, off.y, off.z);

        const ps =
            fx.getComponent(ParticleSystem2D) ??
            fx.getComponentInChildren(ParticleSystem2D);
        if (ps) {
            this._burstDamageParticle(fx, ps, false);
        } else {
            this.scheduleOnce(() => {
                if (fx.isValid) {
                    fx.destroy();
                }
            }, 1.5);
        }
    }

    private _resolvePlayerNode(): Node | null {
        const hubPlayer = SceneNodeHub.instance?.player;
        if (hubPlayer?.isValid) {
            return hubPlayer;
        }
        const hub = SceneNodeHub.instance;
        const root = hub?.canvasRoot ?? hub?.node;
        if (!root?.isValid) {
            return null;
        }
        const stack = [...root.children];
        while (stack.length > 0) {
            const n = stack.pop()!;
            if (n.getComponent(PlayerFlight)) {
                return n;
            }
            stack.push(...n.children);
        }
        return null;
    }

    /** ParticleSystem2D: 0=FREE (остаётся в мире), 1=RELATIVE (едет с узлом). */
    private _applyDamageParticleFollowMode(ps: ParticleSystem2D): void {
        const p = ps as ParticleSystem2D & {
            positionType?: number;
            _positionType?: number;
        };
        p.positionType = 1;
        if (p._positionType !== undefined) {
            p._positionType = 1;
        }
    }

    private _burstDamageParticle(
        fxNode: Node,
        ps: ParticleSystem2D,
        reuseEmbedded: boolean,
    ): void {
        fxNode.active = true;
        ps.enabled = true;
        this._applyDamageParticleFollowMode(ps);
        ps.stopSystem();
        this.scheduleOnce(() => {
            if (!ps.isValid || !fxNode.isValid) {
                return;
            }
            this._applyDamageParticleFollowMode(ps);
            ps.resetSystem();
        }, 0);

        const tail = this._damageParticleTailSec(ps);
        if (reuseEmbedded) {
            this._embeddedDamageParticleHideRemain = Math.max(
                this._embeddedDamageParticleHideRemain,
                tail,
            );
            this.unschedule(this._hideEmbeddedDamageParticle);
            this.schedule(this._hideEmbeddedDamageParticle, 0.05);
            return;
        }

        this.scheduleOnce(() => {
            if (fxNode.isValid) {
                ps.stopSystem();
                fxNode.destroy();
            }
        }, tail);
    }

    private _damageParticleTailSec(ps: ParticleSystem2D): number {
        return (
            Math.max(0.15, ps.duration > 0 ? ps.duration : 0.25) +
            ps.life +
            ps.lifeVar +
            0.35
        );
    }

    private _hideEmbeddedDamageParticle = (): void => {
        this._embeddedDamageParticleHideRemain -= 0.05;
        if (this._embeddedDamageParticleHideRemain > 0) {
            return;
        }
        this.unschedule(this._hideEmbeddedDamageParticle);
        const player = this._resolvePlayerNode();
        const embedded = player?.getChildByName(
            GameManager.DAMAGE_PARTICLE_CHILD,
        );
        if (!embedded?.isValid) {
            return;
        }
        const ps = embedded.getComponent(ParticleSystem2D);
        ps?.stopSystem();
        embedded.active = false;
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
        this._currentHp = 0;
        this._damageInvincibleRemain = 0;
        if (SoundController.instance?.library?.getClip(SoundId.InstantKill)) {
            SoundController.instance.play(SoundId.InstantKill);
        }
        this.scheduleOnce(() => {
            for (const heart of this._heartNodes) {
                if (heart?.isValid) {
                    heart.active = false;
                }
            }
            this.gameOver();
        }, 0);
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
        this._hideWorldChunkContainers();
        SoundController.instance?.endKtaBgmPhase();
        SoundController.instance?.stopBgm();
        SoundController.instance?.play(SoundId.WallHit);
        SoundController.instance?.playGameOverJingle();
        this._findPlayerAnimation(SceneNodeHub.instance?.player ?? null)
            ?.freezeIdleFlightPose();
        this._showOverlayPanelDeferred(this.gameOverPanel);
        this.scheduleOnce(() => {
            this._refreshGameOverMilestoneLabel();
            this._playGameOverSeedCountRoll(this._score);
        }, 0);
    }

    private _refreshGameOverMilestoneLabel(): void {
        SceneNodeHub.instance?.gameOverMilestoneSign?.setMeters(
            this._lastCompletedMilestoneMeters,
        );
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
