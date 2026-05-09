import { _decorator, Component, Node, Prefab, instantiate, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Бесшовное небо из копий префаба. Ширина сегмента берётся из UITransform при спавне —
 * смена размера префаба учитывается при следующем rebuild / новых чанках.
 * Все ссылки задаются в инспекторе (перетаскиванием).
 */
@ccclass('LevelGenerator')
export class LevelGenerator extends Component {
    @property({
        type: Prefab,
        tooltip: 'Один сегмент неба (префаб). Ширина берётся из UITransform — при смене размера префаба пересборка подхватит автоматически.',
    })
    skySegmentPrefab: Prefab | null = null;

    @property({
        type: Node,
        tooltip: 'Родительский узел, куда будут созданы копии неба (удобно пустой дочерний узел под Canvas).',
    })
    chunkParent: Node | null = null;

    @property({
        type: Node,
        tooltip:
            'Узел с UITransform, по ширине которого считается видимая область (обычно Canvas). От этого числа зависит, сколько сегментов заспавнить.',
    })
    viewRoot: Node | null = null;

    @property({
        type: Component,
        tooltip:
            'Необязательно: компонент с полем isPlaying (например гейм-старт). Если задан — прокрутка только после начала игры; если пусто — с первого кадра.',
    })
    gameFlow: Component | null = null;

    @property({
        tooltip: 'Скорость смещения сегментов неба влево, пикселей в секунду (имитация полёта вперёд).',
    })
    scrollSpeed = 280;

    @property({
        tooltip:
            'Сколько дополнительных сегментов добавить сверх минимально нужного по ширине экрана — запас от «дыр» на широких разрешениях.',
    })
    extraSegments = 1;

    @property({
        tooltip:
            'Запас в пикселях за левой границей видимой области: когда сегмент уходит дальше, он перекидывается вправо для бесшовного цикла.',
    })
    recycleMargin = 64;

    private _segments: Node[] = [];

    start() {
        this.rebuildChunks();
    }

    /** Пересоздать все чанки (например после смены префаба в редакторе у следующего запуска). */
    rebuildChunks() {
        const parent = this.chunkParent ?? this.node;

        for (const n of this._segments) {
            n.destroy();
        }
        this._segments = [];

        if (!this.skySegmentPrefab) {
            return;
        }

        const unitW = this.measurePrefabWorldWidth(this.skySegmentPrefab);
        if (unitW <= 0) {
            return;
        }

        const viewW = this.getViewWidth();
        const count = Math.max(
            2,
            Math.ceil(viewW / unitW) + this.extraSegments + 1,
        );

        let cx = 0;
        const baseY = 0;
        const baseZ = 0;

        for (let i = 0; i < count; i++) {
            const seg = instantiate(this.skySegmentPrefab);
            seg.parent = parent;
            seg.setPosition(cx, baseY, baseZ);
            this._segments.push(seg);
            cx += unitW;
        }
    }

    update(dt: number) {
        if (!this.skySegmentPrefab || this._segments.length === 0) {
            return;
        }
        if (!this.shouldScroll()) {
            return;
        }

        const dx = this.scrollSpeed * dt;
        for (const seg of this._segments) {
            const p = seg.position;
            seg.setPosition(p.x - dx, p.y, p.z);
        }

        const leftBound = -this.getViewHalfWidth() - this.recycleMargin;
        for (const seg of this._segments) {
            if (this.rightEdgeLocal(seg) < leftBound) {
                this.placeAfterRightmost(seg);
            }
        }
    }

    private shouldScroll(): boolean {
        if (!this.gameFlow) {
            return true;
        }
        const g = this.gameFlow as { isPlaying?: boolean };
        return g.isPlaying === true;
    }

    private getViewWidth(): number {
        const root = this.viewRoot ?? this.chunkParent?.parent ?? this.node;
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

    /** Ставит сегмент сразу за самым правым (локальные координаты chunkParent). */
    private placeAfterRightmost(segment: Node) {
        const ui = segment.getComponent(UITransform);
        if (!ui) {
            return;
        }

        let maxRight = -Infinity;
        for (const s of this._segments) {
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
