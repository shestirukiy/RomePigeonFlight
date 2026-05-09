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

/** Один ряд бесшовных сегментов (небо или город). */
type ChunkStrip = {
    segments: Node[];
};

/**
 * Чанки неба/города. Префабы и родители — в Scene Node Hub.
 * Скорость и старт игры — из Game Manager (scrollSpeed).
 */
@ccclass('LevelGenerator')
export class LevelGenerator extends Component {
    @property({
        tooltip:
            'Доп. сегменты сверх минимума по ширине экрана — запас на широких разрешениях.',
    })
    extraSegments = 1;

    @property({
        tooltip:
            'Запас за левой границей экрана (пикс): при выходе сегмента дальше — перенос вправо.',
    })
    recycleMargin = 64;

    private _strips: ChunkStrip[] = [];

    start() {
        this.rebuildChunks();
    }

    rebuildChunks() {
        this.clearStrips();

        const hub = SceneNodeHub.instance;
        if (!hub) {
            return;
        }

        const skyParent = hub.skyChunkParent ?? this.node;
        const townParent = hub.townChunkParent ?? hub.skyChunkParent ?? this.node;

        if (hub.skySegmentPrefab) {
            const strip = this.buildStrip(hub.skySegmentPrefab, skyParent);
            if (strip) {
                this._strips.push(strip);
            }
        }
        if (hub.townSegmentPrefab) {
            const strip = this.buildStrip(hub.townSegmentPrefab, townParent);
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

    private buildStrip(prefab: Prefab, parent: Node): ChunkStrip | null {
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
            segments.push(seg);
            cx += unitW;
        }
        return { segments };
    }

    private getViewWidth(): number {
        const hub = SceneNodeHub.instance;
        const root =
            hub?.viewRoot ??
            hub?.skyChunkParent?.parent ??
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
