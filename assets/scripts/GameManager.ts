import {
    _decorator,
    Animation,
    AnimationClip,
    Button,
    Color,
    Component,
    input,
    Input,
    EventMouse,
    EventTouch,
    Label,
    Material,
    Node,
    Prefab,
    sys,
    Tween,
    UITransform,
    Vec3,
    Vec4,
    instantiate,
    tween,
    ParticleSystem2D,
    SpriteFrame,
} from 'cc';
import { LevelGenerator } from './LevelGenerator';
import { PlayerPathSensors } from './PlayerPathSensors';
import {
    forEachPlayerAnimController,
    PlayerAnimationController,
} from './PlayerAnimationController';
import { SceneNodeHub } from './SceneNodeHub';
import { CameraShake } from './CameraShake';
import { GameIntroController } from './GameIntroController';
import { GameSession, PLAYER_FLIGHT_CCLASS } from './GameSession';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';
import { AnimatedPrefabSpawner } from './AnimatedPrefabSpawner';

const { ccclass, property, executionOrder } = _decorator;

const G_SCROLL = { id: 'Scroll', name: 'Scrolling' };
const G_MILESTONE = { id: 'Milestones', name: 'Milestone signs' };
const G_UI = { id: 'UI', name: 'UI' };
const G_HP = { id: 'Health', name: 'Health & seeds' };

/**
 * First tap starts the run; scrollSpeed drives LevelGenerator chunk movement.
 * Отдача от стены: через applyWorldKickback (как TowerWallHazard) — состояние меняется в колбэке контакта.
 * Стоп скролла вперёд: PlayerPathSensors вызывает syncPathSensorBlockCounts раз в кадр.
 */
@ccclass('GameManager')
@executionOrder(-95)
export class GameManager extends Component {
    private static readonly GAME_OVER_PANEL_ANIM = 'GameOverPanelAnim';
    private static readonly KTA_PANEL_ANIM = 'KTAPanel';

    private static _inst: GameManager | null = null;

    public static get game(): GameManager | null {
        return GameSession.game;
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

    /** Игнорировать один touch/mouse down (клик по UI). Сбрасывается на up. */
    private _suppressTapToStart = false;

    /** После returnToTapToStart — ждём новый тап (не отпускание клика по Play Again). */
    private _awaitingFirstTapToRun = false;

    private _requireFreshPointerDownForRun = false;

    /** Последний pointer down не запустил забег (suppress / game over). */
    private _pointerDownDidNotStartRun = false;

    /**
     * Пульс (Animation на scale) на той же ноде, что и Button SCALE — перебивает pressed-скейл.
     * На время нажатия ставим клип на паузу.
     */
    private readonly _buttonPulsePressHandlers = new Map<
        Node,
        { pause: () => void; resume: () => void }
    >();

    private _playAgainActionPending = false;

    private _gameOverSeedRollCounter = { value: 0 };
    private _gameOverSeedRollTween: Tween<{ value: number }> | null = null;

    private _damageInvincibleRemain = 0;

    /** Сколько порогов seedsPerExtraLife уже выдали за этот забег. */
    private _seedLifeBonusesGranted = 0;

    /** Слоты UI, зарезервированные под летящие HpHarvest (индекс → в полёте). */
    private readonly _hpHarvestReservedSlots = new Set<number>();

    /** Повторные контакты Ground — один вызов gameOver. */
    private _instantKillPending = false;

    /** Сколько сердечек всплескнут на Game Over (Ground / instantKill). */
    private _gameOverHeartBurstCount = 0;

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
    private readonly _heartRestPos = new Map<Node, Vec3>();
    private readonly _heartRestEuler = new Map<Node, Vec3>();
    /** HpFall в клипе абсолютный — в lateUpdate добавляем rest + delta из клипа. */
    private readonly _heartsFalling = new Set<Node>();
    private readonly _heartFallOnFinished = new Map<
        Node,
        (_type?: string, st?: { name?: string }) => void
    >();
    private readonly _heartFallScheduledFinish = new Map<Node, () => void>();

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

    /** true после Play Again — ждём тап, intro-камеру не показываем. */
    public get isAwaitingFirstTapToRun(): boolean {
        return this._awaitingFirstTapToRun;
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
        type: Node,
        displayName: 'Gameplay UI Root',
        tooltip:
            'Нода UI (сердечки, счёт семечек). Скрывается вне геймплея: заставка, Game Over, KTA, ожидание тапа. Пусто — ищется дочерняя нода «UI» на Canvas.',
    })
    gameplayUiRoot: Node | null = null;

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
        displayName: 'Game Over Heart Particle',
        tooltip:
            'HeartParticle на GameOverPanel. Число частиц = оставшиеся HP при смерти от Ground (0, если HP уже не было).',
    })
    gameOverHeartParticle: Node | null = null;

    @property({
        group: G_UI,
        type: Node,
        displayName: 'KTA Panel',
        tooltip:
            'Показывается по кнопке Continue на Game Over Panel; Play Again возвращает к ожиданию тапа.',
    })
    ktaPanel: Node | null = null;

    @property({
        group: G_UI,
        type: Button,
        displayName: 'Continue Button',
        tooltip:
            'ContinueBttn на GameOverPanel — открывает KTA (перетащите компонент Button с ноды).',
    })
    continueButton: Button | null = null;

    @property({
        group: G_UI,
        type: Button,
        displayName: 'Play Again Button',
        tooltip:
            'PlayAgainBttn на KTAPanel — новый забег после KTA (компонент Button).',
    })
    playAgainButton: Button | null = null;

    @property({
        group: G_UI,
        type: Button,
        displayName: 'Share Button',
        tooltip: 'ShareBttn на KTAPanel (компонент Button).',
    })
    shareButton: Button | null = null;

    @property({
        group: G_UI,
        displayName: 'Share URL',
        tooltip: 'Ссылка, которую откроет кнопка Share (sys.openURL).',
    })
    shareUrl = '';

    @property({
        group: G_UI,
        type: Button,
        displayName: 'Watch Button',
        tooltip: 'WatchBttn на KTAPanel (компонент Button).',
    })
    watchButton: Button | null = null;

    @property({
        group: G_UI,
        displayName: 'Menu Button Camera Shake',
        tooltip:
            'Тряска камеры при нажатии кнопок меню (Continue, Play Again, Share, Watch, Skip/Start на Chunk_Start).',
    })
    shakeCameraOnMenuButtons = true;

    @property({
        group: G_UI,
        displayName: 'Menu Shake Intensity',
        tooltip:
            'Множитель амплитуды тряски для кнопок меню (1 = как при уроне). Только если Menu Button Camera Shake включён.',
        min: 0,
        max: 2,
        step: 0.05,
        slide: true,
    })
    menuButtonCameraShakeIntensity = 0.65;

    @property({
        group: G_UI,
        displayName: 'Play Again Press Delay (s)',
        tooltip:
            'Пауза после нажатия Play Again перед сбросом — чтобы успел scale pressed (обычно ≈ duration кнопки).',
        min: 0,
        max: 1,
        step: 0.01,
        slide: true,
    })
    playAgainPressFeedbackDelaySec = 0.12;

    @property({
        group: G_UI,
        displayName: 'Watch URL',
        tooltip: 'Ссылка, которую откроет кнопка Watch (sys.openURL).',
    })
    watchUrl = '';

    @property({
        group: G_UI,
        displayName: 'Seed Count Roll Duration (s)',
        tooltip:
            'За сколько секунд счётчик на game over дойдёт от 0 до фактического счёта.',
    })
    gameOverSeedCountRollDurationSec = 1.2;

    @property({
        group: G_UI,
        displayName: 'Milestone Meters Roll Duration (s)',
        tooltip:
            'Game Over: LabelMeters бежит от 0 до выбранного значения метров за это время.',
    })
    gameOverMilestoneRollDurationSec = 1.2;

    @property({
        group: G_UI,
        displayName: 'Game Over: Total Meters Flown',
        tooltip:
            'Вкл. — на Game Over точная дистанция забега (пролетел в метрах). ' +
            'Выкл. — метры последней пройденной вехи (столб MilestoneSign). ' +
            'Влияет на LabelMeters и комментарий GameOverAchievementPhrase.',
    })
    gameOverShowTotalMetersFlown = false;

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
        group: G_HP,
        type: Prefab,
        displayName: 'Damage Particle FX Prefab',
        tooltip: 'Префаб DamageParticleFX — спавн при потере HP (рядом с игроком).',
    })
    damageParticleFxPrefab: Prefab | null = null;

    @property({
        group: G_HP,
        displayName: 'Damage FX Local Offset',
        tooltip: 'Смещение всплеска перьев относительно корня Player (как на старом DamageParticle).',
    })
    damageParticleLocalOffset = new Vec3(24.684, -8.364, 0);

    @property({
        group: G_HP,
        type: Material,
        displayName: 'Particle Alpha Blend Material',
        tooltip:
            'Только assets/materials/ParticleAlphaBlend.mtl (builtin-particle, alpha-blend). ' +
            'Пусто — остаётся Custom Material с эмиттера (default-sprite / ui-sprite). ' +
            'Не назначайте сюда ui-sprite-material или default-sprite-renderer.',
    })
    particleAlphaBlendMaterial: Material | null = null;

    /** builtin-particle — единственный эффект, где есть mainTexture / tintColor. */
    private static readonly BUILTIN_PARTICLE_EFFECT_UUID =
        'd1346436-ac96-4271-b863-1f4fdead95b0';

    @property({
        group: G_HP,
        type: AnimationClip,
        displayName: 'HP Fall Clip',
        tooltip:
            'HpFall: смещение из клипа добавляется к позиции сердечка (относительное падение).',
    })
    hpFallClip: AnimationClip | null = null;

    private static readonly HP_FALL_CLIP_NAME = 'HpFall';

    onLoad() {
        GameManager._inst = this;
        GameSession.bind(this);
        this._setSpeedLinesEmitter(false);
        this._refreshScoreLabel();
        this.resetHp();
        if (this.hpHeartAnchor?.isValid && !this._resolveHpFallClip()) {
            console.warn(
                '[GameManager] HP Fall Clip не назначен — при уроне сердечко скроется без анимации.',
            );
        }
        this._hideOverlayPanels();
        this._syncGameplayUiVisible();
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
    }

    start() {
        this._bindUiButtons();
        this._syncGameplayUiVisible();
    }

    onDestroy() {
        this._cancelPendingPlayAgain();
        this._stopGameOverSeedCountRoll();
        this._stopGameOverMilestoneMetersRoll();
        this._unbindUiButtons();
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        if (GameManager._inst === this) {
            GameManager._inst = null;
        }
        if (GameSession.game === this) {
            GameSession.bind(null);
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

    lateUpdate(): void {
        for (const heart of this._heartsFalling) {
            if (!heart?.isValid) {
                this._heartsFalling.delete(heart);
                continue;
            }
            this._applyHeartFallRelativePose(heart);
        }
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
        this._cancelPendingPlayAgain();
        this._gameOver = false;
        this._dying = false;
        this._instantKillPending = false;
        this._cancelDeferredDeathSequence();
        this._ktaPanelShown = false;
        this._playing = false;
        this._suppressTapToStart = false;
        this._awaitingFirstTapToRun = true;
        this._requireFreshPointerDownForRun = true;
        this._pointerDownDidNotStartRun = false;
        this._hideOverlayPanels();
        this._syncGameplayUiVisible();
        GameIntroController.skipIntroAfterRestart();
        GameIntroController.instance?.snapToGameplayCamera();
        this._resetRunState();
        this.resetScore();
        this.resetHp();
        SoundController.instance?.resetVariantRotation();
        SoundController.instance?.continueKtaMusicAfterPlayAgain();
        this._prewarmAnimatedPrefabSpawners();

        const player = SceneNodeHub.instance?.player;
        forEachPlayerAnimController(player, (a) => a.playWaitingStay());
    }

    /** Тряска при клике по кнопкам меню / заставки (вызывается из GameIntroController на Chunk_Start). */
    public shakeMenuButton(): void {
        this._shakeCameraOnMenuButton();
    }

    public bindMenuButtonPressFeedback(btn: Button | null): void {
        if (btn) {
            this._enableButtonPressScaleFeedback(btn);
        }
    }

    public unbindMenuButtonPressFeedback(node: Node | null): void {
        if (node?.isValid) {
            this._disableButtonPressScaleFeedback(node);
        }
    }

    /** Новый забег по тапу (первый вход или после returnToTapToStart). */
    public startNewRun(): void {
        if (this._playing) {
            return;
        }
        this._awaitingFirstTapToRun = false;
        this._requireFreshPointerDownForRun = false;
        this._pointerDownDidNotStartRun = false;
        this._suppressTapToStart = false;
        SoundController.instance?.playRunStartTap();
        this._gameOver = false;
        this._dying = false;
        this._instantKillPending = false;
        this._cancelDeferredDeathSequence();
        this._ktaPanelShown = false;
        this._hideOverlayPanels();
        // Чанки уже созданы (LevelGenerator.start / returnToTapToStart) — не rebuild,
        // иначе Chunk_Start пересоздаётся и циклическая анимация с Play On Load с нуля.
        this._resetRunState(false);
        this._playing = true;
        this.resetScore();
        this.resetHp();
        this._syncGameplayUiVisible();
        SoundController.instance?.resetVariantRotation();
        SoundController.instance?.playMusicForNewRun();
    }

    private _prewarmAnimatedPrefabSpawners(): void {
        const scene = this.node.scene;
        if (!scene?.isValid) {
            return;
        }
        const spawners = scene.getComponentsInChildren(AnimatedPrefabSpawner);
        if (!spawners?.length) {
            return;
        }
        for (const s of spawners) {
            if (s?.isValid) {
                s.prewarmNow();
            }
        }
    }

    private _resolveGameplayUiRoot(): Node | null {
        if (this.gameplayUiRoot?.isValid) {
            return this.gameplayUiRoot;
        }
        const canvas = SceneNodeHub.instance?.canvas ?? this.node;
        return canvas.getChildByName('UI');
    }

    /** HUD (сердечки, семечки) только во время активного геймплея. */
    private _syncGameplayUiVisible(): void {
        const root = this._resolveGameplayUiRoot();
        if (!root?.isValid) {
            return;
        }
        const show = this.isPlaying;
        if (root.active !== show) {
            root.active = show;
        }
        if (!show) {
            SceneNodeHub.instance?.hideAllPhrases();
        }
    }

    private _hideOverlayPanels(): void {
        this._stopGameOverSeedCountRoll();
        this._stopGameOverMilestoneMetersRoll();
        SceneNodeHub.instance?.gameOverAchievementPhrase?.clearPhrase();
        if (this.gameOverPanel?.isValid) {
            this._stopGameOverPanelIntro();
            this.gameOverPanel.active = false;
        }
        if (this.ktaPanel?.isValid) {
            this._stopKtaPanelIntro();
            this.ktaPanel.active = false;
        }
    }

    private _showOverlayPanel(panel: Node | null): void {
        if (!panel?.isValid) {
            return;
        }
        panel.setPosition(0, 0, 0);
        panel.active = true;
        if (panel === this.gameOverPanel) {
            this._replayGameOverPanelIntro();
        } else if (panel === this.ktaPanel) {
            this._replayKtaPanelIntro();
        }
    }

    private _stopGameOverPanelIntro(): void {
        const panel = this.gameOverPanel;
        if (!panel?.isValid) {
            return;
        }
        this._stopPanelIntroAnim(panel, GameManager.GAME_OVER_PANEL_ANIM);
        this._stopPanelParticles(panel);
    }

    private _replayGameOverPanelIntro(): void {
        const panel = this.gameOverPanel;
        if (!panel?.isValid) {
            return;
        }
        this._replayPanelIntroAnim(panel, GameManager.GAME_OVER_PANEL_ANIM);
        this._replayPanelParticles(panel);
    }

    /** playOnLoad только при первом enable — при каждом открытии KTA сбрасываем клип. */
    private _replayKtaPanelIntro(): void {
        const panel = this.ktaPanel;
        if (!panel?.isValid) {
            return;
        }
        this._replayPanelIntroAnim(panel, GameManager.KTA_PANEL_ANIM);
    }

    private _stopKtaPanelIntro(): void {
        const panel = this.ktaPanel;
        if (!panel?.isValid) {
            return;
        }
        this._stopPanelIntroAnim(panel, GameManager.KTA_PANEL_ANIM);
    }

    /** playOnLoad срабатывает только при первом enable — при повторном game over нужен play(). */
    private _replayPanelIntroAnim(panel: Node, clipName: string): void {
        const anim =
            panel.getComponent(Animation) ??
            panel.getComponentInChildren(Animation);
        if (!anim?.isValid) {
            return;
        }
        const state = anim.getState(clipName);
        if (state) {
            state.stop();
            state.time = 0;
        } else {
            anim.stop();
        }
        anim.play(clipName);
    }

    private _stopPanelIntroAnim(panel: Node, clipName: string): void {
        const anim =
            panel.getComponent(Animation) ??
            panel.getComponentInChildren(Animation);
        if (!anim?.isValid) {
            return;
        }
        const state = anim.getState(clipName);
        if (state) {
            state.stop();
            state.time = 0;
            return;
        }
        anim.stop();
    }

    /** ParticleSystem2D на GameOverPanel: перья всегда; сердечки — по {@link _gameOverHeartBurstCount}. */
    private _replayPanelParticles(panel: Node): void {
        const heartNode = this.gameOverHeartParticle;
        const heartCount = this._gameOverHeartBurstCount;

        for (const ps of panel.getComponentsInChildren(ParticleSystem2D)) {
            if (!ps?.isValid) {
                continue;
            }
            if (heartNode?.isValid && ps.node === heartNode) {
                continue;
            }
            this._burstPanelParticle(ps, ps.node);
        }

        if (!heartNode?.isValid || heartCount <= 0) {
            return;
        }
        const heartPs = heartNode.getComponent(ParticleSystem2D);
        if (!heartPs?.isValid) {
            return;
        }
        this._setParticleTotalCount(heartPs, heartCount);
        this._burstPanelParticle(heartPs, heartNode);
    }

    private _setParticleTotalCount(ps: ParticleSystem2D, count: number): void {
        const n = Math.max(0, Math.floor(count));
        const p = ps as ParticleSystem2D & {
            totalParticles?: number;
            _totalParticles?: number;
        };
        p.totalParticles = n;
        if (p._totalParticles !== undefined) {
            p._totalParticles = n;
        }
    }

    /**
     * Опционально: ParticleAlphaBlend.mtl + текстура из Sprite Frame.
     * Если поле пусто или назначен не тот материал — Custom Material эмиттера не трогаем.
     */
    private _prepareParticleSpriteForRuntime(ps: ParticleSystem2D): void {
        const template = this.particleAlphaBlendMaterial;
        if (!template?.isValid || !this._isBuiltinParticleMaterial(template)) {
            return;
        }

        const sf = this._getParticleSpriteFrame(ps);
        if (!sf?.texture) {
            return;
        }

        let inst = this._particleMaterialBySystem.get(ps);
        if (!inst?.isValid) {
            inst = new Material();
            inst.copy(template);
            this._particleMaterialBySystem.set(ps, inst);
        }

        if (!inst.passes?.length) {
            return;
        }

        const passIdx = 0;
        const tex = sf.texture;
        inst.setProperty('mainTexture', tex, passIdx);
        inst.setProperty('tintColor', new Vec4(1, 1, 1, 1), passIdx);

        const bound = ps as ParticleSystem2D & { customMaterial?: Material };
        bound.customMaterial = inst;
    }

    private _isBuiltinParticleMaterial(mat: Material): boolean {
        const effect = mat.effectAsset as { uuid?: string } | null;
        return effect?.uuid === GameManager.BUILTIN_PARTICLE_EFFECT_UUID;
    }

    private _getParticleSpriteFrame(ps: ParticleSystem2D): SpriteFrame | null {
        const p = ps as ParticleSystem2D & {
            spriteFrame?: SpriteFrame | null;
            _spriteFrame?: SpriteFrame | null;
        };
        return p.spriteFrame ?? p._spriteFrame ?? null;
    }

    private _burstPanelParticle(ps: ParticleSystem2D, fxNode: Node): void {
        fxNode.active = true;
        ps.enabled = true;
        this._prepareParticleSpriteForRuntime(ps);
        ps.stopSystem();
        this.scheduleOnce(() => {
            if (!ps.isValid || !fxNode.isValid) {
                return;
            }
            ps.resetSystem();
        }, 0);
    }

    private _stopPanelParticles(panel: Node): void {
        for (const ps of panel.getComponentsInChildren(ParticleSystem2D)) {
            if (ps?.isValid) {
                ps.stopSystem();
            }
        }
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
        this._syncGameplayUiVisible();
        if (this.gameOverPanel?.isValid) {
            this._stopGameOverPanelIntro();
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

    private _bindUiButtons(): void {
        this._unbindUiButtons();
        const cont = this._resolveContinueButton();
        if (cont) {
            cont.node.on(Button.EventType.CLICK, this._onContinueClick, this);
            this._enableButtonPressScaleFeedback(cont);
        }
        const again = this._resolvePlayAgainButton();
        if (again) {
            again.node.on(Button.EventType.CLICK, this._onPlayAgainClick, this);
            this._enableButtonPressScaleFeedback(again);
        }
        const share = this._resolveShareButton();
        if (share) {
            share.node.on(Button.EventType.CLICK, this._onShareClick, this);
            this._enableButtonPressScaleFeedback(share);
        }
        const watch = this._resolveWatchButton();
        if (watch) {
            watch.node.on(Button.EventType.CLICK, this._onWatchClick, this);
            this._enableButtonPressScaleFeedback(watch);
        }
    }

    private _unbindUiButtons(): void {
        const cont = this._resolveContinueButton();
        if (cont?.node?.isValid) {
            cont.node.off(Button.EventType.CLICK, this._onContinueClick, this);
            this._disableButtonPressScaleFeedback(cont.node);
        }
        const again = this._resolvePlayAgainButton();
        if (again?.node?.isValid) {
            again.node.off(Button.EventType.CLICK, this._onPlayAgainClick, this);
            this._disableButtonPressScaleFeedback(again.node);
        }
        const share = this._resolveShareButton();
        if (share?.node?.isValid) {
            share.node.off(Button.EventType.CLICK, this._onShareClick, this);
            this._disableButtonPressScaleFeedback(share.node);
        }
        const watch = this._resolveWatchButton();
        if (watch?.node?.isValid) {
            watch.node.off(Button.EventType.CLICK, this._onWatchClick, this);
            this._disableButtonPressScaleFeedback(watch.node);
        }
    }

    /**
     * Animation (пульс scale) и Button.transition=SCALE конфликтуют:
     * клип каждый кадр перезаписывает scale, pressed не виден. Пауза на время нажатия.
     * PlayAgainBttn: пульс в клипе KTAPanel на родителе, не на ноде кнопки.
     */
    private _enableButtonPressScaleFeedback(btn: Button): void {
        const node = btn.node;
        if (!node?.isValid || this._buttonPulsePressHandlers.has(node)) {
            return;
        }
        if (btn.transition !== Button.Transition.SCALE) {
            return;
        }

        const pulseAnims: Animation[] = [];
        const selfAnim = node.getComponent(Animation);
        if (selfAnim) {
            pulseAnims.push(selfAnim);
        }
        if (!selfAnim) {
            const panelAnim = this._resolveKtaPanelPulseAnimation(btn);
            if (panelAnim) {
                pulseAnims.push(panelAnim);
            }
        }
        if (pulseAnims.length === 0) {
            return;
        }

        const pause = () => {
            for (const anim of pulseAnims) {
                if (anim.isValid) {
                    anim.pause();
                }
            }
        };
        const resume = () => {
            for (const anim of pulseAnims) {
                if (anim.isValid) {
                    anim.resume();
                }
            }
        };
        this._buttonPulsePressHandlers.set(node, { pause, resume });
        node.on(Node.EventType.TOUCH_START, pause, this);
        node.on(Node.EventType.TOUCH_END, resume, this);
        node.on(Node.EventType.TOUCH_CANCEL, resume, this);
        node.on(Node.EventType.MOUSE_DOWN, pause, this);
        node.on(Node.EventType.MOUSE_UP, resume, this);
    }

    /** KTAPanel.anim пульсирует scale у PlayAgainBttn через иерархию. */
    private _resolveKtaPanelPulseAnimation(btn: Button): Animation | null {
        const panel = this.ktaPanel;
        if (panel?.isValid && this._isNodeUnderPanel(btn.node, panel)) {
            return panel.getComponent(Animation);
        }
        let cur: Node | null = btn.node.parent;
        while (cur) {
            if (cur.name === 'KTAPanel') {
                return cur.getComponent(Animation);
            }
            cur = cur.parent;
        }
        return null;
    }

    private _isNodeUnderPanel(node: Node, panel: Node): boolean {
        let cur: Node | null = node;
        while (cur) {
            if (cur === panel) {
                return true;
            }
            cur = cur.parent;
        }
        return false;
    }

    private _disableButtonPressScaleFeedback(node: Node): void {
        if (!node?.isValid) {
            return;
        }
        const handlers = this._buttonPulsePressHandlers.get(node);
        if (!handlers) {
            return;
        }
        node.off(Node.EventType.TOUCH_START, handlers.pause, this);
        node.off(Node.EventType.TOUCH_END, handlers.resume, this);
        node.off(Node.EventType.TOUCH_CANCEL, handlers.resume, this);
        node.off(Node.EventType.MOUSE_DOWN, handlers.pause, this);
        node.off(Node.EventType.MOUSE_UP, handlers.resume, this);
        this._buttonPulsePressHandlers.delete(node);
    }

    /** Тряска камеры при клике по кнопкам меню (если включено в UI). */
    private _shakeCameraOnMenuButton(): void {
        if (!this.shakeCameraOnMenuButtons) {
            return;
        }
        const mult = Math.max(0, this.menuButtonCameraShakeIntensity);
        if (mult <= 0) {
            return;
        }
        CameraShake.instance?.shake(mult);
    }

    private _resolveContinueButton(): Button | null {
        if (this.continueButton?.isValid) {
            return this.continueButton;
        }
        const panel = this.gameOverPanel;
        if (!panel?.isValid) {
            return null;
        }
        const node =
            panel.getChildByName('ContinueBttn') ??
            panel.getChildByName('ContinueBtn');
        return node?.getComponent(Button) ?? null;
    }

    private _resolvePlayAgainButton(): Button | null {
        if (this.playAgainButton?.isValid) {
            return this.playAgainButton;
        }
        const panel = this.ktaPanel;
        if (!panel?.isValid) {
            return null;
        }
        return (
            panel.getChildByName('PlayAgainBttn')?.getComponent(Button) ?? null
        );
    }

    private _resolveShareButton(): Button | null {
        if (this.shareButton?.isValid) {
            return this.shareButton;
        }
        const panel = this.ktaPanel;
        if (!panel?.isValid) {
            return null;
        }
        return panel.getChildByName('ShareBttn')?.getComponent(Button) ?? null;
    }

    private _resolveWatchButton(): Button | null {
        if (this.watchButton?.isValid) {
            return this.watchButton;
        }
        const panel = this.ktaPanel;
        if (!panel?.isValid) {
            return null;
        }
        return panel.getChildByName('WatchBttn')?.getComponent(Button) ?? null;
    }

    private _onContinueClick(): void {
        this._shakeCameraOnMenuButton();
        if (this._dying || !this._gameOver || this._ktaPanelShown) {
            return;
        }
        this._showKtaPanel();
    }

    private _onPlayAgainClick(): void {
        this._shakeCameraOnMenuButton();
        if (this._dying || !this._gameOver || !this._ktaPanelShown) {
            return;
        }
        if (this._playAgainActionPending) {
            return;
        }

        const btn = this._resolvePlayAgainButton();
        const delay = this._playAgainPressDelaySec(btn);
        if (delay <= 0) {
            this.returnToTapToStart();
            return;
        }

        this._playAgainActionPending = true;
        this.scheduleOnce(this._executePlayAgainAfterPressFeedback, delay);
    }

    private _playAgainPressDelaySec(btn: Button | null): number {
        if (this.playAgainPressFeedbackDelaySec > 0) {
            return this.playAgainPressFeedbackDelaySec;
        }
        const transitionSec = btn?.duration ?? 0.1;
        return transitionSec + 0.02;
    }

    private _executePlayAgainAfterPressFeedback(): void {
        this._playAgainActionPending = false;
        if (this._dying || !this._gameOver || !this._ktaPanelShown) {
            return;
        }
        this.returnToTapToStart();
    }

    private _cancelPendingPlayAgain(): void {
        this.unschedule(this._executePlayAgainAfterPressFeedback);
        this._playAgainActionPending = false;
    }

    private _onShareClick(): void {
        this._shakeCameraOnMenuButton();
        if (this._dying || !this._gameOver || !this._ktaPanelShown) {
            return;
        }
        const url = this.shareUrl.trim();
        if (url) {
            sys.openURL(url);
        }
    }

    private _onWatchClick(): void {
        this._shakeCameraOnMenuButton();
        if (this._dying || !this._gameOver || !this._ktaPanelShown) {
            return;
        }
        const url = this.watchUrl.trim();
        if (url) {
            sys.openURL(url);
        }
    }

    private _onMenuTap(): void {
        if (GameIntroController.instance?.isBlockingInput) {
            this._pointerDownDidNotStartRun = true;
            return;
        }
        if (this._suppressTapToStart) {
            this._pointerDownDidNotStartRun = true;
            return;
        }
        this._pointerDownDidNotStartRun = !this._tryStartRunFromMenuTap();
    }

    private _tryStartRunFromMenuTap(): boolean {
        if (this._dying) {
            return false;
        }
        if (this._playing && !this._gameOver) {
            return false;
        }
        if (this._gameOver) {
            // GameOver → KTAPanel только через кнопку Continue.
            return false;
        }
        this.startNewRun();
        return true;
    }

    private _tryStartRunAfterPointerUp(): void {
        if (this._requireFreshPointerDownForRun) {
            return;
        }
        if (!this._awaitingFirstTapToRun || !this._pointerDownDidNotStartRun) {
            return;
        }
        if (GameIntroController.instance?.isBlockingInput) {
            return;
        }
        this._pointerDownDidNotStartRun = false;
        this._tryStartRunFromMenuTap();
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

    /**
     * @param rebuildChunks true — уничтожить и заново создать чанки (Play Again).
     * false — оставить текущие сегменты (первый тап / старт забега).
     */
    private _resetRunState(rebuildChunks = true): void {
        this._resetScrollAndKickback();

        const levelGen = this.getComponent(LevelGenerator);
        if (rebuildChunks) {
            levelGen?.rebuildChunks();
        } else {
            levelGen?.setAllChunkLayersActive(true);
        }

        const player = SceneNodeHub.instance?.player;
        if (player) {
            this._playerFlightOf(player)?.resetToSpawn();
            player.getComponent(PlayerPathSensors)?.resetForNewRun();
            forEachPlayerAnimController(player, (a) => a.resetForNewRun());
        }
    }

    /** Без import PlayerFlight — разрыв цикла GameManager ↔ PlayerFlight. */
    private _playerFlightOf(node: Node | null | undefined): {
        resetToSpawn(): void;
        releaseInput(): void;
    } | null {
        if (!node?.isValid) {
            return null;
        }
        return node.getComponent(PLAYER_FLIGHT_CCLASS) as {
            resetToSpawn(): void;
            releaseInput(): void;
        } | null;
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
            if (this.grantExtraLifeWithHarvest()) {
                SceneNodeHub.instance?.showLifeRestored();
            }
        }
    }

    /** +1 HP: сначала HpHarvest на игроке, UI-сердечко — по прилёту. */
    public grantExtraLifeWithHarvest(): boolean {
        const slotIndex = this._findNextVacantHeartSlotIndex();
        if (!this._canGrantHeartSlot(slotIndex)) {
            return false;
        }

        this._hpHarvestReservedSlots.add(slotIndex);
        this._hideHeartSlotUntilHarvest(slotIndex);

        const target = new Vec3();
        if (!this._getHeartSlotWorldPosition(slotIndex, target)) {
            this._hpHarvestReservedSlots.delete(slotIndex);
            return this._commitGrantExtraLifeAtSlot(slotIndex);
        }

        const playerRoot = SceneNodeHub.instance?.player ?? null;
        let harvestStarted = false;
        forEachPlayerAnimController(playerRoot, (anim) => {
            if (harvestStarted) {
                return;
            }
            if (
                anim.playHpHarvest(target, slotIndex, () => {
                    this._commitGrantExtraLifeAtSlot(slotIndex);
                    this._hpHarvestReservedSlots.delete(slotIndex);
                })
            ) {
                harvestStarted = true;
            }
        });
        if (harvestStarted) {
            return true;
        }

        this._hpHarvestReservedSlots.delete(slotIndex);
        console.warn(
            '[GameManager] HpHarvest не запустился — сердечко в UI сразу.',
        );
        return this._commitGrantExtraLifeAtSlot(slotIndex);
    }

    /**
     * Первый свободный слот: логически пустой (HP), падает HpFall или уже зарезервирован под harvest.
     */
    private _findNextVacantHeartSlotIndex(): number {
        for (let i = 0; i < this._heartNodes.length; i++) {
            if (this._hpHarvestReservedSlots.has(i)) {
                continue;
            }
            if (this._isVacantHeartSlot(i)) {
                return i;
            }
        }
        let i = this._heartNodes.length;
        while (this._hpHarvestReservedSlots.has(i)) {
            i++;
        }
        return i;
    }

    /** Самый левый свободный слот при завершении harvest (кроме чужих резервов). */
    private _findVacantSlotForCommit(releasingReservation: number): number {
        for (let i = 0; i < this._heartNodes.length; i++) {
            if (
                this._hpHarvestReservedSlots.has(i) &&
                i !== releasingReservation
            ) {
                continue;
            }
            if (this._isVacantHeartSlot(i)) {
                return i;
            }
        }
        let i = this._heartNodes.length;
        while (
            this._hpHarvestReservedSlots.has(i) &&
            i !== releasingReservation
        ) {
            i++;
        }
        return i;
    }

    /** Слот пуст для +HP: за пределами текущего HP, скрыт или сердечко уже «сорвано» падением. */
    private _isVacantHeartSlot(index: number): boolean {
        if (index < 0) {
            return false;
        }
        if (index >= this._heartNodes.length) {
            return index === this._heartNodes.length;
        }
        const heart = this._heartNodes[index];
        if (heart?.isValid && this._heartsFalling.has(heart)) {
            return true;
        }
        if (index >= this._currentHp) {
            return true;
        }
        return !heart?.isValid || !heart.active;
    }

    private _canGrantHeartSlot(slotIndex: number): boolean {
        if (slotIndex < this._heartNodes.length) {
            return true;
        }
        if (slotIndex !== this._heartNodes.length) {
            return false;
        }
        const anchor = this.hpHeartAnchor;
        return !!(anchor?.isValid && anchor.parent);
    }

    private _hideHeartSlotUntilHarvest(slotIndex: number): void {
        if (slotIndex < 0 || slotIndex >= this._heartNodes.length) {
            return;
        }
        const heart = this._heartNodes[slotIndex];
        if (heart?.isValid) {
            this._cancelHeartFall(heart);
            heart.active = false;
        }
    }

    /** Мировая позиция слота HP (для HpHarvest, в т.ч. скрытые сердечки). */
    public getHeartSlotWorldPosition(index: number, out: Vec3): boolean {
        return this._getHeartSlotWorldPosition(index, out);
    }

    private _getHeartSlotWorldPosition(index: number, out: Vec3): boolean {
        const anchor = this.hpHeartAnchor;
        if (!anchor?.isValid) {
            return false;
        }

        if (index >= 0 && index < this._heartNodes.length) {
            const heart = this._heartNodes[index];
            if (!heart?.isValid) {
                return false;
            }
            return this._heartSlotRestToWorld(heart, out);
        }

        if (index !== this._heartNodes.length) {
            return false;
        }

        const last = this._heartNodes[this._heartNodes.length - 1] ?? anchor;
        const parent = last.parent ?? anchor.parent;
        if (!parent?.isValid) {
            return false;
        }

        const lastRest = this._heartRestPos.get(last) ?? last.position;
        const local = lastRest.clone();
        local.x += this._heartStepX();
        const ui = parent.getComponent(UITransform);
        if (ui) {
            ui.convertToWorldSpaceAR(local, out);
            return true;
        }

        parent.updateWorldTransform();
        Vec3.transformMat4(out, local, parent.worldMatrix);
        return true;
    }

    /**
     * Актуальный слот для HpHarvest (урон мог «освободить» ячейку после старта полёта).
     */
    public resolveHeartHarvestSlotIndex(requestedSlot: number): number {
        return this._findVacantSlotForCommit(requestedSlot);
    }

    /** Показать сердечко в UI в зарезервированном слоте. */
    private _commitGrantExtraLifeAtSlot(requestedSlot: number): boolean {
        const slotIndex = this._findVacantSlotForCommit(requestedSlot);
        if (slotIndex < 0) {
            return false;
        }

        if (slotIndex < this._heartNodes.length) {
            const heart = this._heartNodes[slotIndex];
            if (heart?.isValid) {
                this._cancelHeartFall(heart);
                this._restoreHeartRestPose(heart);
                heart.active = true;
            }
            this._currentHp = Math.max(this._currentHp, slotIndex + 1);
            return true;
        }

        if (slotIndex !== this._heartNodes.length) {
            return false;
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
        this._registerHeartNode(heart);
        this._spawnedHearts.push(heart);
        this._heartNodes.push(heart);
        this._currentHp = Math.max(this._currentHp, slotIndex + 1);
        return true;
    }

    /** Восстанавливает ряд сердечек (якорь + клоны справа). */
    public resetHp(): void {
        this._clearSpawnedHearts();
        this._heartNodes.length = 0;
        this._currentHp = 0;
        this._hpHarvestReservedSlots.clear();
        this._instantKillPending = false;
        this._gameOverHeartBurstCount = 0;

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
        this._registerHeartNode(anchor);
        this._heartNodes.push(anchor);

        for (let i = 1; i < startHp; i++) {
            const heart = instantiate(anchor);
            heart.parent = parent;
            heart.setPosition(base.x + step * i, base.y, base.z);
            heart.active = true;
            this._registerHeartNode(heart);
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
     * @param invincibilitySec длительность i-frames после успешной потери HP.
     * @returns true, если HP стало 0.
     */
    public takeDamage(
        amount = 1,
        playDamageSound = true,
        deferDeathSequence = false,
        invincibilitySec = 0,
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
            this._currentHp--;
            const idx = this._currentHp;
            const heart = this._heartNodes[idx];
            if (heart?.isValid) {
                this._playHpFallOnHeart(heart);
            }
            lost++;
        }

        if (lost > 0) {
            if (playDamageSound) {
                SoundController.instance?.play(SoundId.Damage);
            }
            CameraShake.instance?.shakeOnDamage();
            this._playDamageParticleOnPlayer();
            if (invincibilitySec > 0) {
                this._damageInvincibleRemain = invincibilitySec;
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

    private readonly _particleMaterialBySystem = new WeakMap<
        ParticleSystem2D,
        Material
    >();

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
            if (n.getComponent(PLAYER_FLIGHT_CCLASS)) {
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
        this._prepareParticleSpriteForRuntime(ps);
        this._applyDamageParticleFollowMode(ps);
        ps.stopSystem();
        this.scheduleOnce(() => {
            if (!ps.isValid || !fxNode.isValid) {
                return;
            }
            this._prepareParticleSpriteForRuntime(ps);
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
        this._gameOverHeartBurstCount = 0;
        this._cancelDeferredDeathSequence();
        this._dying = true;
        this._syncGameplayUiVisible();
        this._damageInvincibleRemain = 0;
        this.cancelWorldKickback();
        this._resetScrollAndKickback();

        const player = SceneNodeHub.instance?.player;
        this._playerFlightOf(player)?.releaseInput();

        let started = false;
        let deathDone = false;
        const onDeathDone = () => {
            if (deathDone) {
                return;
            }
            deathDone = true;
            this._dying = false;
            this.gameOver();
        };
        forEachPlayerAnimController(player ?? null, (anim) => {
            if (anim.playDeath(onDeathDone)) {
                started = true;
            }
        });
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

        if (this._instantKillPending) {
            return;
        }

        this._gameOverHeartBurstCount = Math.max(0, this._currentHp);
        this._instantKillPending = true;
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
        this._instantKillPending = false;
        this._cancelDeferredDeathSequence();
        this._dying = false;
        this._gameOver = true;
        this._playing = false;
        this._ktaPanelShown = false;
        this._hideOverlayPanels();
        this._syncGameplayUiVisible();
        this._hideWorldChunkContainers();
        SoundController.instance?.endKtaBgmPhase();
        SoundController.instance?.stopBgm();
        SoundController.instance?.play(SoundId.WallHit);
        SoundController.instance?.playGameOverJingle();
        forEachPlayerAnimController(
            SceneNodeHub.instance?.player ?? null,
            (a) => a.freezeIdleFlightPose(),
        );

        this._showOverlayPanelDeferred(this.gameOverPanel);

        this._bindUiButtons();
        this.scheduleOnce(() => {
            this._playGameOverMilestoneMetersRoll();
            this._refreshGameOverAchievementPhrase();
            this._playGameOverSeedCountRoll(this._score);
        }, 0);
    }

    /** Метры для Game Over: веха или полная дистанция забега (см. gameOverShowTotalMetersFlown). */
    private _getGameOverDisplayMeters(): number {
        if (this.gameOverShowTotalMetersFlown) {
            return Math.max(0, Math.floor(this.flightDistanceMeters));
        }
        return Math.max(0, Math.floor(this._lastCompletedMilestoneMeters));
    }

    private _refreshGameOverAchievementPhrase(): void {
        SceneNodeHub.instance?.gameOverAchievementPhrase?.refreshForMeters(
            this._getGameOverDisplayMeters(),
        );
    }

    private _playGameOverMilestoneMetersRoll(): void {
        const display = SceneNodeHub.instance?.gameOverMilestoneSign;
        if (!display?.isValid) {
            return;
        }
        display.playMetersRollFromZero(
            this._getGameOverDisplayMeters(),
            this.gameOverMilestoneRollDurationSec,
        );
    }

    private _stopGameOverMilestoneMetersRoll(): void {
        const sign = SceneNodeHub.instance?.gameOverMilestoneSign;
        if (!sign?.isValid) {
            return;
        }
        sign.stopMetersRoll();
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
        this._gameOverSeedRollTween = tween(this._gameOverSeedRollCounter)
            .to(
                duration,
                { value: target },
                {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (!this.isValid || !label.isValid) {
                            return;
                        }
                        label.string = `${Math.round(this._gameOverSeedRollCounter.value)}`;
                    },
                },
            )
            .call(() => {
                this._gameOverSeedRollTween = null;
                if (label.isValid) {
                    label.string = `${target}`;
                }
            })
            .start();
    }

    private _stopGameOverSeedCountRoll(): void {
        if (this._gameOverSeedRollTween) {
            this._gameOverSeedRollTween.stop();
            this._gameOverSeedRollTween = null;
        }
        if (!this._gameOverSeedRollCounter) {
            this._gameOverSeedRollCounter = { value: 0 };
            return;
        }
        this._gameOverSeedRollCounter.value = 0;
    }

    private _clearSpawnedHearts(): void {
        for (const heart of this._heartNodes) {
            if (heart?.isValid) {
                this._cancelHeartFall(heart);
            }
        }
        for (const n of this._spawnedHearts) {
            if (n?.isValid) {
                this._heartRestPos.delete(n);
                this._heartRestEuler.delete(n);
                n.destroy();
            }
        }
        this._spawnedHearts.length = 0;
        this._heartsFalling.clear();
    }

    private _registerHeartNode(heart: Node): void {
        if (!heart?.isValid) {
            return;
        }
        this._heartRestPos.set(heart, heart.position.clone());
        this._heartRestEuler.set(heart, heart.eulerAngles.clone());
        this._ensureHeartFallAnimation(heart);
    }

    private _restoreHeartRestPose(heart: Node): void {
        if (!heart?.isValid) {
            return;
        }
        const pos = this._heartRestPos.get(heart);
        if (pos) {
            heart.setPosition(pos);
        }
        const euler = this._heartRestEuler.get(heart);
        if (euler) {
            heart.setRotationFromEuler(euler.x, euler.y, euler.z);
        }
        const anim = heart.getComponent(Animation);
        anim?.stop();
    }

    private _resolveHpFallClip(): AnimationClip | null {
        if (this.hpFallClip?.name) {
            return this.hpFallClip;
        }

        const anchor = this.hpHeartAnchor;
        const anchorAnim = anchor?.getComponent(Animation);
        if (anchorAnim) {
            for (const c of anchorAnim.clips) {
                if (c?.name === GameManager.HP_FALL_CLIP_NAME) {
                    return c;
                }
            }
            if (anchorAnim.defaultClip?.name === GameManager.HP_FALL_CLIP_NAME) {
                return anchorAnim.defaultClip;
            }
        }

        return null;
    }

    private _ensureHeartFallAnimation(heart: Node): Animation | null {
        const clip = this._resolveHpFallClip();
        if (!clip) {
            return heart.getComponent(Animation);
        }

        let anim = heart.getComponent(Animation);
        if (!anim) {
            anim = heart.addComponent(Animation);
        }
        if (anim.clips.indexOf(clip) < 0) {
            anim.addClip(clip);
        }
        anim.defaultClip = clip;
        return anim;
    }

    private _playHpFallOnHeart(heart: Node): void {
        if (!heart?.isValid) {
            return;
        }

        this._cancelHeartFall(heart);

        const clip = this._resolveHpFallClip();
        const anim = this._ensureHeartFallAnimation(heart);
        if (!clip || !anim) {
            heart.active = false;
            return;
        }

        const clipName = clip.name;
        this._restoreHeartRestPose(heart);
        heart.active = true;

        const finish = () => {
            const onFinished = this._heartFallOnFinished.get(heart);
            if (onFinished) {
                anim.off(Animation.EventType.FINISHED, onFinished, this);
                this._heartFallOnFinished.delete(heart);
            }
            const fallbackFinish = this._heartFallScheduledFinish.get(heart);
            if (fallbackFinish) {
                this.unschedule(fallbackFinish);
                this._heartFallScheduledFinish.delete(heart);
            }
            this._heartsFalling.delete(heart);
            if (!heart.isValid) {
                return;
            }
            this._restoreHeartRestPose(heart);
            heart.active = false;
        };

        const onFinished = (_type?: string, st?: { name?: string }) => {
            if (st?.name && st.name !== clipName) {
                return;
            }
            finish();
        };

        const fallbackFinish = () => finish();

        this._heartsFalling.add(heart);
        this._heartFallOnFinished.set(heart, onFinished);
        this._heartFallScheduledFinish.set(heart, fallbackFinish);
        anim.on(Animation.EventType.FINISHED, onFinished, this);
        anim.play(clipName);
        this._applyHeartFallRelativePose(heart);
        this.scheduleOnce(
            fallbackFinish,
            Math.max(0.05, clip.duration + 0.05),
        );
    }

    /** Слот UI всегда в «домашней» позиции, не по траектории HpFall. */
    private _heartSlotRestToWorld(heart: Node, out: Vec3): boolean {
        const parent = heart.parent;
        if (!parent?.isValid) {
            return false;
        }
        const local = this._heartRestPos.get(heart)?.clone() ?? heart.position.clone();
        const ui = parent.getComponent(UITransform);
        if (ui) {
            ui.convertToWorldSpaceAR(local, out);
            return true;
        }
        parent.updateWorldTransform();
        Vec3.transformMat4(out, local, parent.worldMatrix);
        return true;
    }

    private _cancelHeartFall(heart: Node): void {
        if (!heart?.isValid) {
            return;
        }

        const onFinished = this._heartFallOnFinished.get(heart);
        const fallbackFinish = this._heartFallScheduledFinish.get(heart);
        const anim = heart.getComponent(Animation);
        if (onFinished && anim) {
            anim.off(Animation.EventType.FINISHED, onFinished, this);
        }
        if (fallbackFinish) {
            this.unschedule(fallbackFinish);
        }
        this._heartFallOnFinished.delete(heart);
        this._heartFallScheduledFinish.delete(heart);
        this._heartsFalling.delete(heart);
        anim?.stop();
        this._restoreHeartRestPose(heart);
    }

    /** Клип HpFall задаёт local (0,0) → (0,−Y); прибавляем к сохранённой позиции слота. */
    private _applyHeartFallRelativePose(heart: Node): void {
        const rest = this._heartRestPos.get(heart);
        if (!rest) {
            return;
        }
        const delta = heart.position;
        heart.setPosition(rest.x + delta.x, rest.y + delta.y, rest.z + delta.z);

        const restEuler = this._heartRestEuler.get(heart);
        if (!restEuler) {
            return;
        }
        const deltaEuler = heart.eulerAngles;
        heart.setRotationFromEuler(
            restEuler.x + deltaEuler.x,
            restEuler.y + deltaEuler.y,
            restEuler.z + deltaEuler.z,
        );
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
        this._requireFreshPointerDownForRun = false;
        this._onMenuTap();
    }

    private _onTouchEnd(_e: EventTouch | EventMouse) {
        this._suppressTapToStart = false;
        this._tryStartRunAfterPointerUp();
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._requireFreshPointerDownForRun = false;
            this._onMenuTap();
        }
    }

    private _onMouseUp(e: EventMouse) {
        if (e.getButton() === 0) {
            this._onTouchEnd(e);
        }
    }
}
