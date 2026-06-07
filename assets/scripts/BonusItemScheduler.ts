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

type TypeState = {
    nextAtMeters: number;
    pending: boolean;
    pendingSinceMeters: number;
};

/**
 * Все настройки собираемых бонусов на уровне:
 * — частота появления в чанках (группа Spawn);
 * — семечки → +HP, шлем (break, отскок, i-frames);
 * magnet / wisdom — частота здесь, эффект пока в GameManager.
 * Компонент уже на ноде LevelGenerator (не добавляйте второй).
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
        tooltip: 'Среднее число жизней на 1000 м (0 — выкл.).',
    })
    lifePer1000m = 0.3;

    @property({
        group: G_BONUS,
        displayName: 'Helmet Per 1000 m',
        tooltip: '0 — выкл., пока нет HelmetPickup.',
    })
    helmetPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Magnet Per 1000 m',
        tooltip: '0 — выкл. magnet_item (SeedMagnetPickup) в endless-чанках.',
    })
    magnetPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Wisdom Per 1000 m',
        tooltip: '0 — выкл. wisdom_item в endless-чанках.',
    })
    wisdomPer1000m = 0;

    @property({
        group: G_BONUS,
        displayName: 'Min Interval Meters',
        tooltip: 'Минимальный зазор между срабатываниями одного типа.',
    })
    minIntervalMeters = 200;

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

    /** I-frames после ground-bounce шлема. */
    public getHelmetGroundInvincibilitySec(): number {
        const inv = this.helmetGroundInvincibilitySec;
        if (inv > 0) {
            return inv;
        }
        return Math.max(0.05, this.helmetGroundGraceSec);
    }

    private readonly _states = new Map<BonusItemType, TypeState>();
    private _enabledTypes: BonusItemType[] = [];
    private _lastTickMeters = 0;
    private _forcedChunkPrefab: Prefab | null = null;

    onLoad(): void {
        BonusItemScheduler._inst = this;
    }

    onDestroy(): void {
        if (BonusItemScheduler._inst === this) {
            BonusItemScheduler._inst = null;
        }
    }

    public resetForRun(): void {
        this._states.clear();
        this._enabledTypes = this._buildEnabledTypes();
        this._lastTickMeters = 0;
        this._forcedChunkPrefab = null;

        for (const type of this._enabledTypes) {
            this._states.set(type, {
                nextAtMeters: this._randomNextAt(0, type),
                pending: false,
                pendingSinceMeters: 0,
            });
        }

        if (this.debugLog) {
            console.log(
                '[BonusItemScheduler] reset',
                this._enabledTypes.map((t) => BonusItemType[t]),
            );
        }
    }

    public tick(flightDistanceMeters: number): void {
        if (this._enabledTypes.length === 0) {
            return;
        }

        const meters = Math.max(0, flightDistanceMeters);
        this._lastTickMeters = meters;

        for (const type of this._enabledTypes) {
            const state = this._states.get(type);
            if (!state || state.pending) {
                continue;
            }
            if (meters + 1e-4 < state.nextAtMeters) {
                continue;
            }
            state.pending = true;
            state.pendingSinceMeters = meters;
            if (this.debugLog) {
                console.log(
                    `[BonusItemScheduler] pending ${BonusItemType[type]} at ${meters.toFixed(0)} m`,
                );
            }
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
        if (this._enabledTypes.length === 0 || !this._hasAnyPending()) {
            return;
        }

        const pickups = collectScheduledPickups(chunkRoot);
        if (pickups.length === 0) {
            return;
        }

        for (const type of this._enabledTypes) {
            const state = this._states.get(type);
            if (!state?.pending) {
                continue;
            }

            const matching = pickups.filter((p) => p.itemType === type);
            if (matching.length === 0) {
                continue;
            }

            const pick =
                matching[Math.floor(Math.random() * matching.length)];
            pick.activate();
            state.pending = false;
            state.nextAtMeters = this._randomNextAt(this._lastTickMeters, type);

            if (this.debugLog) {
                console.log(
                    `[BonusItemScheduler] activated ${BonusItemType[type]} "${pick.node.name}" in "${chunkRoot.name}"`,
                );
            }
        }

        this._updateForcedChunk(this._lastTickMeters);
    }

    private _hasAnyPending(): boolean {
        for (const type of this._enabledTypes) {
            if (this._states.get(type)?.pending) {
                return true;
            }
        }
        return false;
    }

    private _updateForcedChunk(meters: number): void {
        if (this._forcedChunkPrefab || !this.fallbackBonusChunk) {
            return;
        }

        for (const type of this._enabledTypes) {
            const state = this._states.get(type);
            if (!state?.pending) {
                continue;
            }
            if (meters - state.pendingSinceMeters < this.maxWaitMeters) {
                continue;
            }
            this._forcedChunkPrefab = this.fallbackBonusChunk;
            if (this.debugLog) {
                warn(
                    `[BonusItemScheduler] fallback chunk for pending ${BonusItemType[type]} after ${this.maxWaitMeters} m`,
                );
            }
            return;
        }
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

    private _randomNextAt(fromMeters: number, type: BonusItemType): number {
        const rate = this._rateFor(type);
        if (rate <= 0) {
            return Number.POSITIVE_INFINITY;
        }
        const meanGap = 1000 / rate;
        const u = Math.max(1e-6, Math.random());
        const gap = Math.max(this.minIntervalMeters, -Math.log(u) * meanGap);
        return fromMeters + gap;
    }
}
