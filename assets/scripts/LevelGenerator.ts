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

const { ccclass, property } = _decorator;

/** Одна полоса тайлинга для слоя параллакса */
type ChunkStrip = {
    segments: Node[];
    /** План 1: при ресайкле сегмент пересоздаётся из очереди префабов */
    plane1RecycleSwap?: boolean;
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

/**
 * Плоскости 2 и 3 — один префаб на слой, классический тайлинг.
 * Плоскость 1 — одна схема: Tutorial → Mandatory → Endless (веса) → базовый Plane 1 Segment Prefab.
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

    private _strips: ChunkStrip[] = [];

    /** Индекс следующего спавна для цепочки плана 1 (tutorial + mandatory + endless). */
    private _plane1SpawnCounter = 0;

    start() {
        this.rebuildChunks();
    }

    rebuildChunks() {
        this.clearStrips();
        this._plane1SpawnCounter = 0;

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

        const leftBound = -this.getViewHalfWidth() - this.recycleMargin;

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
        const valid = this.plane1EndlessChunks.filter(
            (e) => e && e.prefab && e.weight > 0,
        );
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
            const prefab = this.resolvePlane1PrefabBySpawnIndex(
                this._plane1SpawnCounter,
            );
            if (!prefab) {
                break;
            }

            const seg = instantiate(prefab);
            LevelGenerator._ensureObstacleHazardsOnSubtree(seg);
            seg.parent = parent;

            const ui = seg.getComponent(UITransform);
            if (!ui) {
                seg.destroy();
                this._plane1SpawnCounter++;
                continue;
            }
            const sx = Math.abs(seg.scale.x);
            const half = ui.width * ui.anchorX * sx;

            const cx = segments.length === 0 ? 0 : prevRight + half;
            seg.setPosition(cx, 0, 0);
            prevRight = this.rightEdgeLocal(seg);
            segments.push(seg);
            this._plane1SpawnCounter++;
        }

        if (segments.length === 0) {
            return null;
        }
        return {
            segments,
            plane1RecycleSwap: true,
            parallaxFactor: this.plane1ParallaxFactor,
        };
    }

    private recyclePlane1Segment(strip: ChunkStrip, segment: Node) {
        const segments = strip.segments;
        const idx = segments.indexOf(segment);
        if (idx < 0 || !segment.parent?.isValid) {
            return;
        }

        const prefab = this.resolvePlane1PrefabBySpawnIndex(
            this._plane1SpawnCounter,
        );
        if (!prefab) {
            this.placeAfterRightmost(segment, segments);
            return;
        }
        this._plane1SpawnCounter++;

        const parent = segment.parent;
        const siblingIndex = segment.getSiblingIndex();
        segment.destroy();

        const newSeg = instantiate(prefab);
        LevelGenerator._ensureObstacleHazardsOnSubtree(newSeg);
        parent!.addChild(newSeg);
        newSeg.setSiblingIndex(siblingIndex);
        segments[idx] = newSeg;
        this.placeAfterRightmost(newSeg, segments);
    }

    private clearStrips() {
        for (const strip of this._strips) {
            for (const n of strip.segments) {
                n.destroy();
            }
        }
        this._strips = [];
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
        const baseY = 0;
        const baseZ = 0;

        for (let i = 0; i < count; i++) {
            const seg = instantiate(prefab);
            LevelGenerator._ensureObstacleHazardsOnSubtree(seg);
            seg.parent = parent;
            seg.setPosition(cx, baseY, baseZ);
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
