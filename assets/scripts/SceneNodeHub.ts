import { _decorator, Component, Node, Prefab } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Ссылки на узлы и префабы для игровой логики (на Canvas).
 * Фон — только бесшовные чанки (Level Generator); цельные «большие картинки» не используются.
 */
@ccclass('SceneNodeHub')
export class SceneNodeHub extends Component {
    private static _inst: SceneNodeHub | null = null;

    public static get instance(): SceneNodeHub | null {
        return SceneNodeHub._inst;
    }

    @property({
        type: Node,
        tooltip:
            'Корень UI. На Canvas можно не задавать — подставится сам Canvas (узел этого компонента).',
    })
    canvasRoot: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Узел игрока.',
    })
    player: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Родитель инстансов чанков неба (Level Generator).',
    })
    skyChunkParent: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Родитель инстансов чанков города; может совпадать с небом.',
    })
    townChunkParent: Node | null = null;

    @property({
        type: Node,
        tooltip:
            'Ширина экрана для расчёта числа чанков (UITransform). На Canvas можно не задавать.',
    })
    viewRoot: Node | null = null;

    @property({
        type: Prefab,
        tooltip: 'Префаб одного сегмента неба.',
    })
    skySegmentPrefab: Prefab | null = null;

    @property({
        type: Prefab,
        tooltip: 'Префаб одного сегмента города.',
    })
    townSegmentPrefab: Prefab | null = null;

    onLoad() {
        SceneNodeHub._inst = this;
        if (!this.canvasRoot) {
            this.canvasRoot = this.node;
        }
        if (!this.viewRoot) {
            this.viewRoot = this.node;
        }
    }

    onDestroy() {
        if (SceneNodeHub._inst === this) {
            SceneNodeHub._inst = null;
        }
    }

    /** Корень UI (хаб на Canvas = сам Canvas). */
    public get canvas(): Node {
        return this.canvasRoot ?? this.node;
    }
}
