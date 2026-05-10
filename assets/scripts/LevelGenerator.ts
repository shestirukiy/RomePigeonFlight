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

const { ccclass, property } = _decorator;

/** One tiled strip for a single parallax plane. */
type ChunkStrip = {
    segments: Node[];
};

const G_SCROLL = { id: 'Scroll', name: 'Scrolling' };
const G_PLANES = { id: 'Planes', name: 'Parallax planes' };

/**
 * Three parallax planes + scroll. SceneNodeHub supplies viewRoot and optional plane-3 parent fallback.
 */
@ccclass('LevelGenerator')
export class LevelGenerator extends Component {
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
        type: Prefab,
        displayName: 'Plane 1 Segment Prefab',
        tooltip: 'Ширина UITransform корня = шаг тайлинга.',
    })
    plane1SegmentPrefab: Prefab | null = null;

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
            'Например Chunk_2Clouds. Чанки встают под игроком по sibling index.',
    })
    plane3SegmentPrefab: Prefab | null = null;

    private _strips: ChunkStrip[] = [];

    start() {
        this.rebuildChunks();
    }

    rebuildChunks() {
        this.clearStrips();

        const hub = SceneNodeHub.instance;

        const p1Parent = this.plane1ChunkParent ?? this.node;
        const p2Parent =
            this.plane2ChunkParent ?? this.plane1ChunkParent ?? this.node;

        if (this.plane1SegmentPrefab) {
            const strip = this.buildStrip(this.plane1SegmentPrefab, p1Parent);
            if (strip) {
                this._strips.push(strip);
            }
        }
        if (this.plane2SegmentPrefab) {
            const strip = this.buildStrip(this.plane2SegmentPrefab, p2Parent);
            if (strip) {
                this._strips.push(strip);
            }
        }

        const p3Parent =
            this.plane3ChunkParent ?? hub?.player?.parent ?? null;
        if (this.plane3SegmentPrefab && p3Parent) {
            const strip = this.buildStrip(
                this.plane3SegmentPrefab,
                p3Parent,
                true,
            );
            if (strip) {
                this._strips.push(strip);
            }
        }
    }

    update(dt: number) {
        const dx = this.getScrollPixels(dt);
        if (dx <= 0 || this._strips.length === 0) {
            return;
        }

        const leftBound = -this.getViewHalfWidth() - this.recycleMargin;

        for (const strip of this._strips) {
            for (const seg of strip.segments) {
                const p = seg.position;
                seg.setPosition(p.x - dx, p.y, p.z);
            }
            for (const seg of strip.segments) {
                if (this.rightEdgeLocal(seg) < leftBound) {
                    this.placeAfterRightmost(seg, strip.segments);
                }
            }
        }
    }

    private getScrollPixels(dt: number): number {
        const game = GameManager.game;
        if (!game?.isPlaying) {
            return 0;
        }
        return game.scrollSpeed * dt;
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
     * @param insertAtLowSiblingIndex — для 3-го плана: чанки ближе к началу списка детей,
     *   чтобы рисоваться под игроком (ниже sibling index в UI обычно раньше в отрисовке).
     */
    private buildStrip(
        prefab: Prefab,
        parent: Node,
        insertAtLowSiblingIndex = false,
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
            seg.parent = parent;
            seg.setPosition(cx, baseY, baseZ);
            if (insertAtLowSiblingIndex) {
                seg.setSiblingIndex(i);
            }
            segments.push(seg);
            cx += unitW;
        }
        return { segments };
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
            if (s !== segment) {
                maxRight = Math.max(maxRight, this.rightEdgeLocal(s));
            }
        }

        const sx = Math.abs(segment.scale.x);
        const half = ui.width * ui.anchorX * sx;
        const nx = maxRight + half;
        segment.setPosition(nx, segment.position.y, segment.position.z);
    }
}
