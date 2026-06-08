import { _decorator, AnimationClip, Component, Node, Prefab, warn } from 'cc';
import { BonusItemType } from './BonusItemType';
import {
    collectScheduledPickups,
    deactivateAllScheduledPickups,
} from './BonusItemPickups';

const { ccclass, property } = _decorator;

const G_BONUS = {
    id: 'BonusItems',
    name: 'Spawn (per 1000 m)',
};

const G_SEEDS = {
    id: 'BonusSeeds',
    name: 'Seeds → extra HP',
};

const G_HELMET = {
    id: 'BonusHelmet',
    name: 'Helmet (gameplay)',
};

const G_WISDOM = {
    id: 'BonusWisdom',
    name: 'Wisdom buff',
};

const G_MAGNET_BUFF = {
    id: 'BonusMagnetBuff',
    name: 'Magnet buff',
};

/**
 * Все настройки собираемых бонусов на уровне:
 * — частота появления в чанках (группа Spawn);
 * — семечки → +HP, шлем (break, отскок, i-frames);
 * magnet / wisdom — частота здесь, эффект пока в GameManager.
 * Компонент уже на ноде LevelGenerator (не добавляйте второй).
 *
 * Spawn: один общий поток бонусов (не 4 независимых таймера). *Per1000m — веса типов;
 * *Min Appear (m) — с какой дистанции тип участвует в расписании.
 */
@ccclass('BonusItemScheduler')
export class BonusItemScheduler extends Component {
    private static _inst: BonusItemScheduler | null = null;

    public static get instance(): BonusItemScheduler | null {
        return BonusItemScheduler._inst;
    }

    @property({
        group: G_BONUS,
        displayName: 'Life Per 1000 m',
        tooltip: 'Вес жизни в общем потоке бонусов (0 — выкл.).',
    })
    lifePer1000m = 0.3;

    @property({
        group: G_BONUS,
        displayName: 'Life Min Appear (m)',
        tooltip: 'Жизнь не попадает в расписание, пока дистанция забега меньше этого значения.',
    })
    lifeMinAppearMeters = 0;

    @property({
        group: G_BONUS,
        displayName: 'Helmet Per 1000 m',
        tooltip: 'Вес шлема в общем потоке (0 — выкл.).',
    })
    helmetPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Helmet Min Appear (m)',
        tooltip: 'Шлем не попадает в расписание, пока дистанция забега меньше этого значения.',
    })
    helmetMinAppearMeters = 0;

    @property({
        group: G_BONUS,
        displayName: 'Magnet Per 1000 m',
        tooltip: 'Вес magnet_item в общем потоке (0 — выкл.).',
    })
    magnetPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Magnet Min Appear (m)',
        tooltip: 'Magnet не попадает в расписание, пока дистанция забега меньше этого значения.',
    })
    magnetMinAppearMeters = 0;

    @property({
        group: G_BONUS,
        displayName: 'Wisdom Per 1000 m',
        tooltip: 'Вес wisdom_item в общем потоке (0 — выкл.).',
    })
    wisdomPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Wisdom Min Appear (m)',
        tooltip: 'Wisdom не попадает в расписание, пока дистанция забега меньше этого значения.',
    })
    wisdomMinAppearMeters = 0;

    @property({
        group: G_BONUS,
        displayName: 'Min Interval Meters',
        tooltip:
            'Устаревший пол (не используется в общем расписании). Оставлен для совместимости префабов.',
    })
    minIntervalMeters = 200;

    @property({
        group: G_BONUS,
        displayName: 'Min Gap Any Bonus (m)',
        tooltip:
            'Минимум между двумя выданными бонусами (после активации в чанке). 0 — только по *Per1000m. Не замедляет первый бонус.',
    })
    minGapAnyBonusMeters = 80;

    @property({
        group: G_BONUS,
        displayName: 'Pending Reroll (m)',
        tooltip:
            'Если pending висит столько метров без подходящего слота в чанке — перекинуть на другой тип.',
    })
    pendingRerollMeters = 120;

    @property({
        group: G_BONUS,
        displayName: 'Gap Jitter',
        tooltip:
            'Разброс шага вокруг среднего: 0 = строго по mean, 0.25 ≈ ±25% (равномерно, не экспонента).',
        min: 0,
        max: 0.5,
        step: 0.05,
        slide: true,
    })
    gapJitter = 0.25;

    @property({
        group: G_BONUS,
        displayName: 'Max Wait Meters',
        tooltip:
            'Если pending висит дольше — следующий чанк плана 1 будет fallback-префабом.',
    })
    maxWaitMeters = 800;

    @property({
        group: G_BONUS,
        type: Prefab,
        displayName: 'Fallback Bonus Chunk',
        tooltip:
            'Чанк с неактивными life_item (Chunk_BonusLifeSlots). Пусто — только endless-чанки со своими life_item.',
    })
    fallbackBonusChunk: Prefab | null = null;

    @property({
        group: G_BONUS,
        displayName: 'Exclude Fixed Chunks',
        tooltip:
            'Не активировать пикапы в tutorial / mandatory / milestone / bonus-after-milestone чанках.',
    })
    excludeFixedChunks = true;

    @property({
        group: G_BONUS,
        displayName: 'Debug Log',
    })
    debugLog = false;

    @property({
        group: G_SEEDS,
        displayName: 'Seeds Per Extra Life',
        tooltip:
            'За каждые N собранных семечек за забег — +1 HP (HpHarvest). 0 — выкл.',
    })
    seedsPerExtraLife = 100;

    @property({
        group: G_HELMET,
        type: Prefab,
        displayName: 'Break FX Prefab',
        tooltip:
            'Отдельный VFX (HelmetBreakFx): Sprite + HelmetBreakEffect. ' +
            'Спавн вне игрока; HelmetEff только «надет». Пусто — клон HelmetEff.',
    })
    helmetBreakFxPrefab: Prefab | null = null;

    @property({
        group: G_HELMET,
        type: AnimationClip,
        displayName: 'Break Clip',
        tooltip:
            'Клип спадания (HelmetBreakEffect.anim). Пусто — сразу скрыть equipped.',
    })
    helmetBreakClip: AnimationClip | null = null;

    @property({
        group: G_HELMET,
        displayName: 'Ground Grace (s)',
        tooltip:
            'После отскока от Ground: не считать повторное касание земли смертельным.',
    })
    helmetGroundGraceSec = 1.25;

    @property({
        group: G_HELMET,
        displayName: 'Ground Invincibility (s)',
        tooltip:
            'I-frames после отскока (стены / облака). 0 — как Ground Grace.',
    })
    helmetGroundInvincibilitySec = 0;

    @property({
        group: G_HELMET,
        displayName: 'Ground Bounce Factor',
        tooltip:
            'Доля Max Up Speed с PlayerFlight (0.5 = медленнее отскок, ~¼ высоты; ' +
            '0.7 ≈ половина высоты). Учитывает flight-множители после вех.',
    })
    helmetGroundBounceFactor = 0.55;

    @property({
        group: G_HELMET,
        displayName: 'Ground Lift Lock (s)',
        tooltip: 'Блок flap сразу после отскока от земли.',
    })
    helmetGroundLiftLockSec = 0.35;

    @property({
        group: G_WISDOM,
        displayName: 'Buff Duration (s)',
    })
    wisdomBuffDurationSec = 8;

    @property({
        group: G_WISDOM,
        displayName: 'Slow Percent',
        tooltip: 'На сколько % снижается скорость мира при препятствии в WisdomCollider (50 → ×0.5).',
    })
    wisdomSlowPercent = 50;

    @property({
        group: G_WISDOM,
        displayName: 'Slow Ease (s)',
        tooltip: 'Плавность входа/выхода замедления скорости мира.',
    })
    wisdomSlowEaseSec = 0.35;

    @property({
        group: G_WISDOM,
        displayName: 'Slow Release Delay (s)',
        tooltip:
            'После того как препятствие пропало из WisdomCollider — пауза перед выходом из замедления (затем разгон по Slow Ease). 0 — сразу.',
    })
    wisdomSlowReleaseDelaySec = 0.25;

    @property({
        group: G_WISDOM,
        displayName: 'Reduce Milestone Speed Bonus',
        tooltip:
            'Пока активен Wisdom — ослаблять прирост скорости от пройденных вех (Milestone Bonus Reduction %).',
    })
    wisdomReduceMilestoneSpeedBonus = true;

    @property({
        group: G_WISDOM,
        displayName: 'Milestone Bonus Reduction %',
        tooltip:
            'На сколько % снижается бонус скорости мира от пройденных вех, пока активен Wisdom (50 → половина прироста сверх базовой скорости).',
        visible(this: BonusItemScheduler) {
            return this.wisdomReduceMilestoneSpeedBonus;
        },
    })
    wisdomMilestoneBonusReductionPercent = 50;

    @property({ group: G_WISDOM, type: AnimationClip, displayName: 'Appear Clip' })
    wisdomAppearClip: AnimationClip | null = null;

    @property({ group: G_WISDOM, type: AnimationClip, displayName: 'Loop Clip' })
    wisdomLoopClip: AnimationClip | null = null;

    @property({ group: G_WISDOM, type: AnimationClip, displayName: 'Disappear Clip' })
    wisdomDisappearClip: AnimationClip | null = null;

    @property({
        group: G_WISDOM,
        type: Prefab,
        displayName: 'Disappear FX Prefab',
        tooltip:
            'Отдельный VFX для исчезновения Wisdom. Пусто — клон ноды Wisdom на Player.',
    })
    wisdomDisappearFxPrefab: Prefab | null = null;

    @property({
        group: G_MAGNET_BUFF,
        displayName: 'Buff Duration (s)',
    })
    magnetBuffDurationSec = 6;

    @property({ group: G_MAGNET_BUFF, type: AnimationClip, displayName: 'Appear Clip' })
    magnetAppearClip: AnimationClip | null = null;

    @property({ group: G_MAGNET_BUFF, type: AnimationClip, displayName: 'Loop Clip' })
    magnetLoopClip: AnimationClip | null = null;

    @property({ group: G_MAGNET_BUFF, type: AnimationClip, displayName: 'Disappear Clip' })
    magnetDisappearClip: AnimationClip | null = null;

    @property({
        group: G_MAGNET_BUFF,
        type: Prefab,
        displayName: 'Disappear FX Prefab',
        tooltip:
            'Отдельный VFX для исчезновения Magnet. Пусто — клон ноды Magnet на Player.',
    })
    magnetDisappearFxPrefab: Prefab | null = null;

    /** I-frames после ground-bounce шлема. */
    public getHelmetGroundInvincibilitySec(): number {
        const inv = this.helmetGroundInvincibilitySec;
        if (inv > 0) {
            return inv;
        }
        return Math.max(0.05, this.helmetGroundGraceSec);
    }

    private _enabledTypes: BonusItemType[] = [];
    private _lastTickMeters = 0;
    private _forcedChunkPrefab: Prefab | null = null;

    /** Следующая дистанция для постановки одного pending-бонуса в общую очередь. */
    private _nextBonusAtMeters = Number.POSITIVE_INFINITY;
    /** Когда последний раз реально активировали бонус в чанке. */
    private _lastFulfilledAtMeters = 0;
    /** Не больше одного pending — тип, ожидающий подходящий чанк. */
    private _pendingType: BonusItemType | null = null;
    private _pendingSinceMeters = 0;

    onLoad(): void {
        BonusItemScheduler._inst = this;
    }

    onDestroy(): void {
        if (BonusItemScheduler._inst === this) {
            BonusItemScheduler._inst = null;
        }
    }

    public resetForRun(): void {
        this._enabledTypes = this._buildEnabledTypes();
        this._lastTickMeters = 0;
        this._lastFulfilledAtMeters = 0;
        this._forcedChunkPrefab = null;
        this._pendingType = null;
        this._pendingSinceMeters = 0;
        this._nextBonusAtMeters = this._computeInitialNextBonusAt();

        if (this.debugLog) {
            console.log(
                '[BonusItemScheduler] reset',
                this._enabledTypes.map((t) => BonusItemType[t]),
                `next@${this._nextBonusAtMeters.toFixed(0)}m`,
            );
        }
    }

    public tick(flightDistanceMeters: number): void {
        if (this._enabledTypes.length === 0) {
            return;
        }

        const meters = Math.max(0, flightDistanceMeters);
        this._lastTickMeters = meters;

        if (this._pendingType != null) {
            const wait = meters - this._pendingSinceMeters;
            const reroll = Math.max(20, this.pendingRerollMeters);
            if (wait >= reroll) {
                const next = this._pickWeightedType();
                if (next != null && next !== this._pendingType) {
                    this._pendingType = next;
                    this._pendingSinceMeters = meters;
                    if (this.debugLog) {
                        console.log(
                            `[BonusItemScheduler] reroll pending → ${BonusItemType[next]} at ${meters.toFixed(0)} m`,
                        );
                    }
                }
            }
            this._updateForcedChunk(meters);
            return;
        }

        const minGap = Math.max(0, this.minGapAnyBonusMeters);
        if (
            this._lastFulfilledAtMeters > 0 &&
            meters + 1e-4 < this._lastFulfilledAtMeters + minGap
        ) {
            this._updateForcedChunk(meters);
            return;
        }
        if (meters + 1e-4 < this._nextBonusAtMeters) {
            this._updateForcedChunk(meters);
            return;
        }

        const type = this._pickWeightedType(meters);
        if (type == null) {
            this._nextBonusAtMeters = this._nextMinAppearUnlock(meters);
            this._updateForcedChunk(meters);
            return;
        }

        this._pendingType = type;
        this._pendingSinceMeters = meters;
        if (this.debugLog) {
            console.log(
                `[BonusItemScheduler] pending ${BonusItemType[type]} at ${meters.toFixed(0)} m (next schedule was ${this._nextBonusAtMeters.toFixed(0)} m)`,
            );
        }

        this._updateForcedChunk(meters);
    }

    public consumeForcedChunkPrefab(): Prefab | null {
        const prefab = this._forcedChunkPrefab;
        this._forcedChunkPrefab = null;
        return prefab;
    }

    public onChunkSpawned(chunkRoot: Node, isFixedLayout: boolean): void {
        deactivateAllScheduledPickups(chunkRoot);
        this.fulfillPendingInChunk(chunkRoot, isFixedLayout);
    }

    /** Активировать pending-бонусы только при spawn/recycle чанка (см. onChunkSpawned). */
    public fulfillPendingInChunk(chunkRoot: Node, isFixedLayout: boolean): void {
        if (isFixedLayout && this.excludeFixedChunks) {
            return;
        }
        const pendingType = this._pendingType;
        if (pendingType == null || this._enabledTypes.length === 0) {
            return;
        }

        const pickups = collectScheduledPickups(chunkRoot);
        if (pickups.length === 0) {
            return;
        }

        const matching = pickups.filter((p) => p.itemType === pendingType);
        if (matching.length === 0) {
            const rerollAt = Math.max(20, this.pendingRerollMeters);
            if (this._lastTickMeters - this._pendingSinceMeters >= rerollAt) {
                const candidates = pickups.filter(
                    (p) =>
                        this._isTypeAvailableAt(p.itemType, this._lastTickMeters),
                );
                if (candidates.length > 0) {
                    const pick =
                        candidates[
                            Math.floor(Math.random() * candidates.length)
                        ];
                    pick.activate();
                    this._lastFulfilledAtMeters = this._lastTickMeters;
                    this._pendingType = null;
                    this._pendingSinceMeters = 0;
                    this._nextBonusAtMeters = this._randomNextGlobalAt(
                        this._lastFulfilledAtMeters,
                    );
                    if (this.debugLog) {
                        console.log(
                            `[BonusItemScheduler] reroll fulfill ${BonusItemType[pick.itemType]} "${pick.node.name}" in "${chunkRoot.name}"`,
                        );
                    }
                    this._updateForcedChunk(this._lastTickMeters);
                }
            }
            return;
        }

        const pick =
            matching[Math.floor(Math.random() * matching.length)];
        pick.activate();

        this._lastFulfilledAtMeters = this._lastTickMeters;
        this._pendingType = null;
        this._pendingSinceMeters = 0;
        this._nextBonusAtMeters = this._randomNextGlobalAt(this._lastFulfilledAtMeters);

        if (this.debugLog) {
            console.log(
                `[BonusItemScheduler] activated ${BonusItemType[pendingType]} "${pick.node.name}" in "${chunkRoot.name}" → next@${this._nextBonusAtMeters.toFixed(0)}m`,
            );
        }

        this._updateForcedChunk(this._lastTickMeters);
    }

    private _updateForcedChunk(meters: number): void {
        if (this._forcedChunkPrefab || !this.fallbackBonusChunk) {
            return;
        }
        if (this._pendingType == null) {
            return;
        }
        if (meters - this._pendingSinceMeters < this.maxWaitMeters) {
            return;
        }

        this._forcedChunkPrefab = this.fallbackBonusChunk;
        if (this.debugLog) {
            warn(
                `[BonusItemScheduler] fallback chunk for pending ${BonusItemType[this._pendingType]} after ${this.maxWaitMeters} m`,
            );
        }
    }

    private _minAppearMetersFor(type: BonusItemType): number {
        switch (type) {
            case BonusItemType.Life:
                return Math.max(0, this.lifeMinAppearMeters);
            case BonusItemType.Helmet:
                return Math.max(0, this.helmetMinAppearMeters);
            case BonusItemType.Magnet:
                return Math.max(0, this.magnetMinAppearMeters);
            case BonusItemType.Wisdom:
                return Math.max(0, this.wisdomMinAppearMeters);
            default:
                return 0;
        }
    }

    private _isTypeEnabled(type: BonusItemType): boolean {
        return this._enabledTypes.includes(type);
    }

    private _isTypeAvailableAt(type: BonusItemType, meters: number): boolean {
        return (
            this._isTypeEnabled(type) &&
            meters + 1e-4 >= this._minAppearMetersFor(type)
        );
    }

    private _typesAvailableAt(meters: number): BonusItemType[] {
        return this._enabledTypes.filter((type) =>
            this._isTypeAvailableAt(type, meters),
        );
    }

    /** Ближайшая дистанция, когда откроется хотя бы один ещё недоступный тип. */
    private _nextMinAppearUnlock(fromMeters: number): number {
        let next = Number.POSITIVE_INFINITY;
        for (const type of this._enabledTypes) {
            const min = this._minAppearMetersFor(type);
            if (min > fromMeters + 1e-4) {
                next = Math.min(next, min);
            }
        }
        if (!Number.isFinite(next)) {
            return fromMeters + Math.max(20, this.minGapAnyBonusMeters || 50);
        }
        return next;
    }

    private _buildEnabledTypes(): BonusItemType[] {
        const out: BonusItemType[] = [];
        if (this.lifePer1000m > 0) {
            out.push(BonusItemType.Life);
        }
        if (this.helmetPer1000m > 0) {
            out.push(BonusItemType.Helmet);
        }
        if (this.magnetPer1000m > 0) {
            out.push(BonusItemType.Magnet);
        }
        if (this.wisdomPer1000m > 0) {
            out.push(BonusItemType.Wisdom);
        }
        return out;
    }

    private _rateFor(type: BonusItemType): number {
        switch (type) {
            case BonusItemType.Life:
                return this.lifePer1000m;
            case BonusItemType.Helmet:
                return this.helmetPer1000m;
            case BonusItemType.Magnet:
                return this.magnetPer1000m;
            case BonusItemType.Wisdom:
                return this.wisdomPer1000m;
            default:
                return 0;
        }
    }

    private _totalSpawnRate(meters = this._lastTickMeters): number {
        let total = 0;
        for (const type of this._typesAvailableAt(meters)) {
            total += this._rateFor(type);
        }
        return total;
    }

    private _pickWeightedType(meters = this._lastTickMeters): BonusItemType | null {
        const pool = this._typesAvailableAt(meters);
        if (pool.length === 0) {
            return null;
        }
        const total = this._totalSpawnRate(meters);
        if (total <= 0) {
            return pool[0] ?? null;
        }
        let roll = Math.random() * total;
        for (const type of pool) {
            roll -= this._rateFor(type);
            if (roll <= 0) {
                return type;
            }
        }
        return pool[pool.length - 1] ?? null;
    }

    /** Следующая точка общего расписания: mean = 1000/totalRate, jitter равномерный. */
    private _randomNextGlobalAt(fromMeters: number): number {
        const totalRate = this._totalSpawnRate(fromMeters);
        if (totalRate <= 0) {
            return this._nextMinAppearUnlock(fromMeters);
        }
        const meanGap = 1000 / totalRate;
        const jitter = Math.min(0.5, Math.max(0, this.gapJitter));
        const factor = 1 - jitter + Math.random() * (2 * jitter);
        const gap = Math.max(1, meanGap * factor);
        return fromMeters + gap;
    }

    private _computeInitialNextBonusAt(): number {
        if (this._typesAvailableAt(0).length === 0) {
            return this._nextMinAppearUnlock(0);
        }
        return this._randomNextGlobalAt(0);
    }
}
