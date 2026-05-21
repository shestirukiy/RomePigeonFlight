import {
    _decorator,
    Component,
    Node,
    Prefab,
    instantiate,
    UITransform,
} from 'cc';
import { GameManager } from './GameManager';
import { SceneNodeHub } from './SceneNodeHub';
import { WeightedChunk } from './WeightedChunk';
import { TowerWallHazard } from './TowerWallHazard';
import { ElectricCloudHazard } from './ElectricCloudHazard';
import { MilestoneSign } from './MilestoneSign';
import { MilestoneDistanceLabel } from './MilestoneDistanceLabel';

const { ccclass, property } = _decorator;

/** Одна полоса тайлинга для слоя параллакса */
type ChunkStrip = {
    segments: Node[];
    /** План 1: при ресайкле сегмент пересоздаётся из очереди префабов */
    plane1RecycleSwap?: boolean;
    /** Очередь чанков препятствий (план 1): случайный Y при спавне и ресайкле */
    obstacleVerticalOffset?: boolean;
    /** Доля базового смещения мира (scrollSpeed×dt): дальний слой меньше 1 — классический параллакс */
    parallaxFactor: number;
};

const G_SCROLL = { id: 'Scroll', name: 'Scrolling' };
const G_PARALLAX = { id: 'Parallax', name: 'Parallax (слои 1–3)' };
const G_PLANES = { id: 'Planes', name: 'Parallax planes (2–3)' };
const G_P1 = {
    id: 'Plane1 Chunks',
    name: 'Plane 1 — дальний слой (очередь чанков)',
};
const G_MILESTONE = { id: 'Milestones', name: 'Milestone signs' };
const G_BONUS = {
    id: 'Bonus',
    name: 'Bonus chunks (после вехи)',
};

/**
 * Плоскости 2 и 3 — один префаб на слой, классический тайлинг.
 * Плоскость 1 — Tutorial → Mandatory → Endless (веса); вехи и бонус после вехи вставляются в очередь ресайкла.
 * Скролл каждого слоя умножается на свой Parallax Factor (дальше — медленнее).
 */
@ccclass('LevelGenerator')
export class LevelGenerator extends Component {
    @property({
        group: G_PARALLAX,
        displayName: 'Plane 1 Parallax Factor',
        tooltip:
            'Дальний слой: доля скорости «мира» (0 — не движется, 1 — как слой препятствий). Типично 0.25–0.5.',
    })
    plane1ParallaxFactor = 0.4;

    @property({
        group: G_PARALLAX,
        displayName: 'Plane 2 Parallax Factor',
        tooltip: 'Средний слой. Обычно между планом 1 и 3.',
    })
    plane2ParallaxFactor = 0.72;

    @property({
        group: G_PARALLAX,
        displayName: 'Plane 3 Parallax Factor',
        tooltip:
            'Ближний слой (препятствия / игрок): обычно 1 — совпадает с логикой scrollSpeed.',
    })
    plane3ParallaxFactor = 1;

    @property({
        group: G_SCROLL,
        displayName: 'Extra Segments',
        tooltip:
            'Доп. сегменты сверх минимума по ширине экрана — запас на широких разрешениях.',
    })
    extraSegments = 1;

    @property({
        group: G_SCROLL,
        displayName: 'Recycle Margin',
        tooltip:
            'Запас за левой границей экрана (пикс): при выходе сегмента дальше — перенос вправо.',
    })
    recycleMargin = 64;

    @property({
        group: G_PLANES,
        type: Node,
        displayName: 'Plane 1 Parent',
        tooltip: 'Самый дальний слой (раньше небо).',
    })
    plane1ChunkParent: Node | null = null;

    @property({
        group: G_PLANES,
        type: Node,
        displayName: 'Plane 2 Parent',
        tooltip: 'Средний слой (раньше город).',
    })
    plane2ChunkParent: Node | null = null;

    @property({
        group: G_PLANES,
        type: Prefab,
        displayName: 'Plane 2 Segment Prefab',
        tooltip: 'Средний слой; ширина корня префаба — шаг тайлинга.',
    })
    plane2SegmentPrefab: Prefab | null = null;

    @property({
        group: G_PLANES,
        type: Node,
        displayName: 'Plane 3 Parent',
        tooltip:
            'Ближний слой с игроком / препятствия. Пусто — родитель узла игрока из Scene Node Hub.',
    })
    plane3ChunkParent: Node | null = null;

    @property({
        group: G_PLANES,
        type: Prefab,
        displayName: 'Plane 3 Segment Prefab',
        tooltip:
            'Ближний слой; один префаб на весь тайл.',
    })
    plane3SegmentPrefab: Prefab | null = null;

    @property({
        group: G_PLANES,
        displayName: 'Obstacle Chunk Vertical Offset',
        tooltip:
            'Чанки препятствий (Plane 1 / ObstaclesContainer): случайный Y (±пикс). ' +
            'Не применяется к Tutorial, Mandatory, Milestone Sign, бонусам после вехи и слоям Sky/Town. 0 — выкл.',
    })
    obstacleChunkVerticalOffset = 0;

    @property({
        group: G_P1,
        type: Prefab,
        displayName: 'Plane 1 Segment Prefab',
        tooltip:
            'Базовый тайл после Tutorial/Mandatory и когда Endless Weighted пуст или не выпал отдельный префаб.',
    })
    plane1SegmentPrefab: Prefab | null = null;

    @property({
        group: G_P1,
        displayName: 'Has Tutorial',
        tooltip:
            'Если выкл., Tutorial Chunks не используются; счёт начинается с Mandatory.',
    })
    plane1HasTutorial = true;

    @property({
        group: G_P1,
        type: [Prefab],
        displayName: 'Tutorial Chunks',
        tooltip:
            'Фиксированный порядок в начале забега (0, 1, …). Пусто — пропуск.',
    })
    plane1TutorialChunks: Prefab[] = [];

    @property({
        group: G_P1,
        type: [Prefab],
        displayName: 'Mandatory Chunks',
        tooltip:
            'После туториала — по одному разу по порядку, затем бесконечная часть.',
    })
    plane1MandatoryChunks: Prefab[] = [];

    @property({
        group: G_P1,
        type: [WeightedChunk],
        displayName: 'Endless Weighted Chunks',
        tooltip:
            'Бесконечная часть: случайный выбор по весам. Пусто — этот шаг пропускается, берётся Plane 1 Segment Prefab.',
    })
    plane1EndlessChunks: WeightedChunk[] = [];

    @property({
        group: G_MILESTONE,
        type: Prefab,
        displayName: 'Milestone Sign Prefab',
        tooltip:
            'Chunk_Sign: вставляется по очереди из GameManager, не добавляйте в Endless Weighted.',
    })
    milestoneSignPrefab: Prefab | null = null;

    @property({
        group: G_BONUS,
        displayName: 'Bonus After Milestone',
        tooltip:
            'Следующий сегмент плана 1 после столба вехи — бонусный чанк из списка ниже.',
    })
    bonusChunksAfterMilestone = true;

    @property({
        group: G_BONUS,
        type: [WeightedChunk],
        displayName: 'Bonus Weighted Chunks',
        tooltip:
            'Награда после вехи (семечки, фигуры SeedPattern и т.д.). ' +
            'Не добавляйте в Endless Weighted — только сюда.',
    })
    plane1BonusChunks: WeightedChunk[] = [];

    private _strips: ChunkStrip[] = [];

    /** Индекс следующего спавна для цепочки плана 1 (tutorial + mandatory + endless). */
    private _plane1SpawnCounter = 0;

    private readonly _milestoneQueue: number[] = [];

    /** Следующий ресайкл/спавн плана 1 — бонус после только что поставленной вехи. */
    private _bonusChunkPending = false;

    /** По очереди перебираем бонусные чанки (0 → 1 → 2 → 3 → 0 …). */
    private _bonusChunkRotateIndex = 0;

    /** false — родители слоёв чанков скрыты (например, на KTA). */
    private _chunkLayersActive = true;

    start() {
        this.rebuildChunks();
    }

    /**
     * Вкл/выкл контейнеры слоёв (ObstaclesContainer / TownContainer / SkyContainer).
     * Чанки внутри не трогаем — при выключении родителя всё дерево скрыто.
     */
    public setAllChunkLayersActive(active: boolean): void {
        this._chunkLayersActive = active;
        this._applyChunkLayerVisibility();
        if (active) {
            this._applyStripSegmentsActive(true);
        }
    }

    /** Поставить столб-веху при следующем спавне/ресайкле плана 1. */
    public queueMilestoneChunk(meters: number): void {
        const m = Math.max(0, Math.floor(meters));
        if (m <= 0) {
            return;
        }
        this._milestoneQueue.push(m);
    }

    public clearMilestoneQueue(): void {
        this._milestoneQueue.length = 0;
        this._bonusChunkPending = false;
        this._bonusChunkRotateIndex = 0;
    }

    /**
     * Поставить столб-веху при следующем ресайкле плана 1, если порог уже пройден.
     * Ресайклит только сегмент, который уже ушёл за левый край (как в update),
     * чтобы не сносить чанк, который ещё виден на экране.
     */
    public flushMilestoneSpawnIfReady(): void {
        if (this._milestoneQueue.length === 0) {
            return;
        }
        const game = GameManager.game;
        if (!game?.isPlaying || !this.milestoneSignPrefab) {
            return;
        }
        const meters = this._milestoneQueue[0];
        const ppm = game.pixelsPerMeter;
        if (ppm <= 0 || game.flightDistancePx + 0.5 < meters * ppm) {
            return;
        }

        const strip = this._strips.find((s) => s.plane1RecycleSwap);
        if (!strip || strip.segments.length === 0) {
            return;
        }

        const seg = this._findLeftmostSegmentPastRecycleBound(strip.segments);
        if (!seg) {
            return;
        }
        this.recyclePlane1Segment(strip, seg);
    }

    rebuildChunks() {
        this.clearStrips();
        this.clearMilestoneQueue();
        this._plane1SpawnCounter = 0;
        this._bonusChunkPending = false;

        const hub = SceneNodeHub.instance;

        const p1Parent = this.plane1ChunkParent ?? this.node;
        const p2Parent =
            this.plane2ChunkParent ?? this.plane1ChunkParent ?? this.node;

        const plane1Strip = this.buildPlane1Strip(p1Parent);
        if (plane1Strip) {
            this._strips.push(plane1Strip);
        }

        if (this.plane2SegmentPrefab) {
            const strip = this.buildUniformStrip(
                this.plane2SegmentPrefab,
                p2Parent,
                false,
                this.plane2ParallaxFactor,
            );
            if (strip) {
                this._strips.push(strip);
            }
        }

        const p3Parent =
            this.plane3ChunkParent ?? hub?.player?.parent ?? null;
        if (p3Parent && this.plane3SegmentPrefab) {
            const strip = this.buildUniformStrip(
                this.plane3SegmentPrefab,
                p3Parent,
                true,
                this.plane3ParallaxFactor,
            );
            if (strip) {
                this._strips.push(strip);
            }
        }

        this._chunkLayersActive = true;
        this._applyStripSegmentsActive(true);
        this._applyChunkLayerVisibility();
    }

    update(dt: number) {
        const game = GameManager.game;
        if (!game?.isPlaying || this._strips.length === 0) {
            return;
        }
        const forward = game.getForwardScrollDelta(dt);
        const kick = game.getWorldKickbackDelta(dt);
        if (forward <= 0 && kick <= 0) {
            return;
        }

        const leftBound = this.getRecycleLeftBound();

        for (const strip of this._strips) {
            const f = strip.parallaxFactor;
            const moveLeft = forward * f;
            const moveRight = kick * f;
            for (const seg of strip.segments) {
                const p = seg.position;
                seg.setPosition(
                    p.x - moveLeft + moveRight,
                    p.y,
                    p.z,
                );
            }
            for (const seg of strip.segments) {
                if (this.rightEdgeLocal(seg) < leftBound) {
                    if (strip.plane1RecycleSwap) {
                        this.recyclePlane1Segment(strip, seg);
                    } else {
                        this.placeAfterRightmost(seg, strip.segments);
                    }
                }
            }
        }
    }

    private _resolveNextPlane1Spawn(): {
        prefab: Prefab | null;
        milestoneMeters: number | null;
        allowVerticalOffset: boolean;
    } {
        if (this._bonusChunkPending) {
            this._bonusChunkPending = false;
            const bonus = this.pickPlane1BonusChunk();
            if (bonus) {
                return {
                    prefab: bonus,
                    milestoneMeters: null,
                    allowVerticalOffset: false,
                };
            }
        }

        const milestoneMeters = this._takeMilestoneIfDistanceReached();
        if (milestoneMeters != null && this.milestoneSignPrefab) {
            const prefab = this.milestoneSignPrefab;
            if (this._shouldQueueBonusAfterMilestone()) {
                this._bonusChunkPending = true;
            }
            return {
                prefab,
                milestoneMeters,
                allowVerticalOffset: false,
            };
        }

        const index = this._plane1SpawnCounter;
        const prefab = this.resolvePlane1PrefabBySpawnIndex(index);
        this._plane1SpawnCounter++;
        return {
            prefab,
            milestoneMeters: null,
            allowVerticalOffset: this._prefabAllowsVerticalOffset(prefab),
        };
    }

    /** Смещение по конкретному префабу (не по индексу — надёжнее при ресайкле и вставке вех). */
    private _prefabAllowsVerticalOffset(prefab: Prefab | null): boolean {
        if (!prefab || !this._useObstacleVerticalOffset()) {
            return false;
        }
        return !this._isFixedLayoutPlane1Prefab(prefab);
    }

    private _isFixedLayoutPlane1Prefab(prefab: Prefab): boolean {
        if (this._samePlane1Prefab(this.milestoneSignPrefab, prefab)) {
            return true;
        }
        for (const p of this.plane1TutorialChunks) {
            if (this._samePlane1Prefab(p, prefab)) {
                return true;
            }
        }
        for (const p of this.plane1MandatoryChunks) {
            if (this._samePlane1Prefab(p, prefab)) {
                return true;
            }
        }
        for (const e of this.plane1BonusChunks) {
            if (this._samePlane1Prefab(e?.prefab ?? null, prefab)) {
                return true;
            }
        }
        const name = prefab.name ?? '';
        if (
            /tutorial|chunk_start|start_chunk|chunk_sign|milestone|chunk_bonus|bonus_chunk|chunk_seed/i.test(
                name,
            )
        ) {
            return true;
        }
        return false;
    }

    private _samePlane1Prefab(a: Prefab | null, b: Prefab | null): boolean {
        if (!a || !b) {
            return false;
        }
        if (a === b) {
            return true;
        }
        const ua = (a as { _uuid?: string })._uuid;
        const ub = (b as { _uuid?: string })._uuid;
        return !!ua && ua === ub;
    }

    private _shouldQueueBonusAfterMilestone(): boolean {
        if (!this.bonusChunksAfterMilestone) {
            return false;
        }
        return this.plane1BonusChunks.some(
            (e) => e && e.prefab && e.weight > 0,
        );
    }

    /**
     * Столб только когда пройдена дистанция порога — иначе очередь съедалась
     * по одному на каждый ресайкл чанка и столбы шли с равным шагом по карте.
     */
    private _takeMilestoneIfDistanceReached(): number | null {
        if (this._milestoneQueue.length === 0) {
            return null;
        }
        const game = GameManager.game;
        if (!game?.isPlaying) {
            return null;
        }
        const meters = this._milestoneQueue[0];
        const ppm = game.pixelsPerMeter;
        if (ppm <= 0) {
            return null;
        }
        const needPx = meters * ppm;
        if (game.flightDistancePx + 0.5 < needPx) {
            return null;
        }
        this._milestoneQueue.shift();
        return meters;
    }

    private _setupPlane1Segment(seg: Node, milestoneMeters: number | null): void {
        if (milestoneMeters == null) {
            return;
        }
        const apply = () => {
            if (!seg.isValid) {
                return;
            }
            this._applyMilestoneToSegment(seg, milestoneMeters);
        };
        apply();
        this.scheduleOnce(apply, 0);
    }

    private _applyMilestoneToSegment(seg: Node, milestoneMeters: number): void {
        const host =
            seg.getComponentInChildren(MilestoneDistanceLabel)?.node ??
            seg.getChildByName('MilestoneSign') ??
            seg;
        const sign =
            MilestoneSign.ensureOn(host) ??
            seg.getComponentInChildren(MilestoneSign) ??
            seg.getComponent(MilestoneSign);
        if (sign) {
            sign.setup(milestoneMeters);
            return;
        }
        console.warn(
            '[LevelGenerator] Chunk_Sign: на префабе (или вложенном MilestoneSign) нужны MilestoneSign и/или MilestoneDistanceLabel с привязанным Label.',
        );
    }

    /** Одна цепочка — без отдельного «режима только один префаб». */
    private resolvePlane1PrefabBySpawnIndex(index: number): Prefab | null {
        if (this.plane1HasTutorial && index < this.plane1TutorialChunks.length) {
            return this.plane1TutorialChunks[index] ?? null;
        }
        const tOff = this.plane1HasTutorial ? this.plane1TutorialChunks.length : 0;
        const mandatoryIndex = index - tOff;
        if (
            mandatoryIndex >= 0 &&
            mandatoryIndex < this.plane1MandatoryChunks.length
        ) {
            return this.plane1MandatoryChunks[mandatoryIndex] ?? null;
        }
        const endless = this.pickWeightedPlane1Endless();
        if (endless) {
            return endless;
        }
        return this.plane1SegmentPrefab;
    }

    private pickWeightedPlane1Endless(): Prefab | null {
        return this._pickWeightedPrefab(this.plane1EndlessChunks);
    }

    /** Бонус после вехи: по кругу все валидные элементы Bonus Weighted Chunks. */
    private pickPlane1BonusChunk(): Prefab | null {
        const valid = this.plane1BonusChunks.filter(
            (e) => e && e.prefab && e.weight > 0,
        );
        if (valid.length === 0) {
            console.warn(
                '[LevelGenerator] Bonus Weighted Chunks: нет префабов с weight > 0.',
            );
            return null;
        }
        const idx = this._bonusChunkRotateIndex % valid.length;
        this._bonusChunkRotateIndex++;
        return valid[idx].prefab;
    }

    private _pickWeightedPrefab(pool: WeightedChunk[]): Prefab | null {
        const valid = pool.filter((e) => e && e.prefab && e.weight > 0);
        if (valid.length === 0) {
            return null;
        }
        const total = valid.reduce((s, e) => s + e.weight, 0);
        let roll = Math.random() * total;
        for (const e of valid) {
            roll -= e.weight;
            if (roll <= 0) {
                return e.prefab;
            }
        }
        return valid[valid.length - 1].prefab;
    }

    private getPlane1MinChunkWidth(): number {
        const widths: number[] = [];
        const push = (p: Prefab | null) => {
            if (!p) {
                return;
            }
            const w = this.measurePrefabWorldWidth(p);
            if (w > 0) {
                widths.push(w);
            }
        };
        push(this.plane1SegmentPrefab);
        for (const p of this.plane1TutorialChunks) {
            push(p);
        }
        for (const p of this.plane1MandatoryChunks) {
            push(p);
        }
        for (const e of this.plane1EndlessChunks) {
            push(e?.prefab ?? null);
        }
        for (const e of this.plane1BonusChunks) {
            push(e?.prefab ?? null);
        }
        push(this.milestoneSignPrefab);
        return widths.length > 0 ? Math.min(...widths) : 1080;
    }

    private buildPlane1Strip(parent: Node): ChunkStrip | null {
        const minW = this.getPlane1MinChunkWidth();
        if (minW <= 0) {
            return null;
        }

        const viewW = this.getViewWidth();
        const count = Math.max(
            2,
            Math.ceil(viewW / minW) + this.extraSegments + 1,
        );

        const segments: Node[] = [];
        let prevRight = -Infinity;

        for (let i = 0; i < count; i++) {
            const { prefab, milestoneMeters, allowVerticalOffset } =
                this._resolveNextPlane1Spawn();
            if (!prefab) {
                break;
            }

            const seg = instantiate(prefab);
            LevelGenerator._ensureObstacleHazardsOnSubtree(seg);
            this._setupPlane1Segment(seg, milestoneMeters);
            seg.parent = parent;

            const ui = seg.getComponent(UITransform);
            if (!ui) {
                seg.destroy();
                continue;
            }
            const sx = Math.abs(seg.scale.x);
            const half = ui.width * ui.anchorX * sx;

            const cx = segments.length === 0 ? 0 : prevRight + half;
            if (allowVerticalOffset) {
                this._setObstacleChunkPosition(seg, cx, 0);
            } else {
                seg.setPosition(cx, 0, 0);
            }
            prevRight = this.rightEdgeLocal(seg);
            segments.push(seg);
        }

        if (segments.length === 0) {
            return null;
        }
        return {
            segments,
            plane1RecycleSwap: true,
            parallaxFactor: this.plane1ParallaxFactor,
            obstacleVerticalOffset: this._useObstacleVerticalOffset(),
        };
    }

    private recyclePlane1Segment(strip: ChunkStrip, segment: Node) {
        const segments = strip.segments;
        const idx = segments.indexOf(segment);
        if (idx < 0 || !segment.parent?.isValid) {
            return;
        }

        const { prefab, milestoneMeters, allowVerticalOffset } =
            this._resolveNextPlane1Spawn();
        if (!prefab) {
            this.placeAfterRightmost(segment, segments);
            return;
        }

        const parent = segment.parent;
        const siblingIndex = segment.getSiblingIndex();
        segment.destroy();

        const newSeg = instantiate(prefab);
        LevelGenerator._ensureObstacleHazardsOnSubtree(newSeg);
        this._setupPlane1Segment(newSeg, milestoneMeters);
        parent!.addChild(newSeg);
        newSeg.setSiblingIndex(siblingIndex);
        segments[idx] = newSeg;
        this.placeAfterRightmost(newSeg, segments);
        if (allowVerticalOffset) {
            this._applyObstacleChunkOffsetY(newSeg);
        } else {
            const p = newSeg.position;
            newSeg.setPosition(p.x, 0, p.z);
        }
    }

    private clearStrips() {
        for (const strip of this._strips) {
            for (const n of strip.segments) {
                n.destroy();
            }
        }
        this._strips = [];
    }

    private static readonly OBSTACLES_CONTAINER = 'ObstaclesContainer';
    private static readonly TOWN_CONTAINER = 'TownContainer';
    private static readonly SKY_CONTAINER = 'SkyContainer';

    private _collectChunkLayerParents(): Node[] {
        const hub = SceneNodeHub.instance;
        const raw = [
            this._resolveObstaclesContainer(),
            this._resolveLayerContainer(
                this.plane2ChunkParent,
                LevelGenerator.TOWN_CONTAINER,
            ),
            this._resolveLayerContainer(
                this.plane3ChunkParent ?? hub?.player?.parent ?? null,
                LevelGenerator.SKY_CONTAINER,
            ),
        ];
        const out: Node[] = [];
        const seen = new Set<Node>();
        for (const n of raw) {
            if (!n?.isValid || seen.has(n)) {
                continue;
            }
            seen.add(n);
            out.push(n);
        }
        return out;
    }

    /** Корень препятствий в сцене (не дочерний узел внутри чанка). */
    private _resolveObstaclesContainer(): Node | null {
        return this._resolveLayerContainer(
            this.plane1ChunkParent,
            LevelGenerator.OBSTACLES_CONTAINER,
        );
    }

    private _resolveLayerContainer(
        assigned: Node | null,
        containerName: string,
    ): Node | null {
        if (assigned?.isValid) {
            let n: Node | null = assigned;
            while (n?.isValid) {
                if (n.name === containerName) {
                    return n;
                }
                n = n.parent;
            }
        }
        const root = SceneNodeHub.instance?.canvasRoot ?? this.node;
        return root.getChildByName(containerName);
    }

    private _applyStripSegmentsActive(active: boolean): void {
        for (const strip of this._strips) {
            for (const seg of strip.segments) {
                if (seg?.isValid) {
                    seg.active = active;
                }
            }
        }
    }

    private _applyChunkLayerVisibility(): void {
        const active = this._chunkLayersActive;
        for (const container of this._collectChunkLayerParents()) {
            if (container?.isValid) {
                container.active = active;
            }
        }
    }

    /** Родитель для спавна чанков плана 1 (может совпадать с ObstaclesContainer). */
    private _resolveObstaclesParent(): Node | null {
        if (this.plane1ChunkParent?.isValid) {
            return this.plane1ChunkParent;
        }
        return this._resolveObstaclesContainer();
    }

    /**
     * Один префаб — фиксированный шаг тайлинга (планы 2 и 3).
     */
    private buildUniformStrip(
        prefab: Prefab,
        parent: Node,
        insertAtLowSiblingIndex = false,
        parallaxFactor = 1,
    ): ChunkStrip | null {
        const unitW = this.measurePrefabWorldWidth(prefab);
        if (unitW <= 0) {
            return null;
        }

        const viewW = this.getViewWidth();
        const count = Math.max(
            2,
            Math.ceil(viewW / unitW) + this.extraSegments + 1,
        );

        const segments: Node[] = [];
        let cx = 0;
        const baseZ = 0;

        for (let i = 0; i < count; i++) {
            const seg = instantiate(prefab);
            LevelGenerator._ensureObstacleHazardsOnSubtree(seg);
            seg.parent = parent;
            seg.setPosition(cx, 0, baseZ);
            if (insertAtLowSiblingIndex) {
                seg.setSiblingIndex(i);
            }
            segments.push(seg);
            cx += unitW;
        }
        return { segments, parallaxFactor };
    }

    private getViewWidth(): number {
        const hub = SceneNodeHub.instance;
        const root =
            hub?.viewRoot ??
            this.plane1ChunkParent?.parent ??
            hub?.canvas ??
            this.node;
        const ui = root.getComponent(UITransform);
        return ui ? ui.width : 1080;
    }

    private getViewHalfWidth(): number {
        return this.getViewWidth() * 0.5;
    }

    /** Левая граница ресайкла (локальные координаты родителя чанков). */
    private getRecycleLeftBound(): number {
        return -this.getViewHalfWidth() - this.recycleMargin;
    }

    /** Самый левый сегмент, который уже полностью ушёл за экран (готов к ресайклу). */
    private _findLeftmostSegmentPastRecycleBound(segments: Node[]): Node | null {
        const leftBound = this.getRecycleLeftBound();
        let best: Node | null = null;
        let minX = Infinity;
        for (const seg of segments) {
            if (!seg.isValid || this.rightEdgeLocal(seg) >= leftBound) {
                continue;
            }
            const x = seg.position.x;
            if (x < minX) {
                minX = x;
                best = seg;
            }
        }
        return best;
    }

    private measurePrefabWorldWidth(prefab: Prefab): number {
        const temp = instantiate(prefab);
        const w = this.segmentWorldWidth(temp);
        temp.destroy();
        return w;
    }

    private segmentWorldWidth(n: Node): number {
        const ui = n.getComponent(UITransform);
        if (!ui) {
            return 0;
        }
        return ui.width * Math.abs(n.scale.x);
    }

    private rightEdgeLocal(n: Node): number {
        const ui = n.getComponent(UITransform);
        if (!ui) {
            return n.position.x;
        }
        const sx = Math.abs(n.scale.x);
        return n.position.x + ui.width * (1 - ui.anchorX) * sx;
    }

    private _useObstacleVerticalOffset(): boolean {
        return this.obstacleChunkVerticalOffset > 0;
    }

    /** Случайный Y чанков препятствий (план 1) в [-range, +range]. */
    private _pickObstacleChunkOffsetY(): number {
        const range = Math.max(0, this.obstacleChunkVerticalOffset);
        if (range <= 0) {
            return 0;
        }
        return (Math.random() * 2 - 1) * range;
    }

    private _setObstacleChunkPosition(seg: Node, x: number, z: number): void {
        seg.setPosition(x, this._pickObstacleChunkOffsetY(), z);
    }

    /** Новый Y при ресайкле слоя препятствий; X/Z не трогаем. */
    private _applyObstacleChunkOffsetY(seg: Node): void {
        const p = seg.position;
        seg.setPosition(p.x, this._pickObstacleChunkOffsetY(), p.z);
    }

    private placeAfterRightmost(segment: Node, segments: Node[]) {
        const ui = segment.getComponent(UITransform);
        if (!ui) {
            return;
        }

        let maxRight = -Infinity;
        for (const s of segments) {
            if (s !== segment && s.isValid) {
                maxRight = Math.max(maxRight, this.rightEdgeLocal(s));
            }
        }

        const sx = Math.abs(segment.scale.x);
        const half = ui.width * ui.anchorX * sx;
        const nx = maxRight + half;
        segment.setPosition(nx, segment.position.y, segment.position.z);
    }

    /** В билде на чанках часто нет hazard-скриптов (они только в Main.scene). */
    private static _ensureObstacleHazardsOnSubtree(root: Node): void {
        if (!root?.isValid) {
            return;
        }
        const visit = (n: Node) => {
            const name = n.name;
            if (name === 'TowerBarrier' || name.startsWith('TowerWall')) {
                if (!n.getComponent(TowerWallHazard)) {
                    n.addComponent(TowerWallHazard);
                }
            }
            if (name === 'CloudBarrier') {
                const colliders = n.getChildByName('Colliders');
                const host = colliders ?? n;
                if (!host.getComponent(ElectricCloudHazard)) {
                    host.addComponent(ElectricCloudHazard);
                }
            }
            for (const ch of n.children) {
                visit(ch);
            }
        };
        visit(root);
    }
}
