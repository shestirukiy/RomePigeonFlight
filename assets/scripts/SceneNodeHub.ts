import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Scene references on Canvas: UI root, player, view size root. Chunk prefabs live on LevelGenerator.
 */
@ccclass('SceneNodeHub')
export class SceneNodeHub extends Component {
    private static _inst: SceneNodeHub | null = null;

    public static get instance(): SceneNodeHub | null {
        return SceneNodeHub._inst;
    }

    @property({
        type: Node,
        displayName: 'Canvas Root',
        tooltip:
            'Корень UI. На Canvas можно не задавать — подставится сам Canvas (узел этого компонента).',
    })
    canvasRoot: Node | null = null;

    @property({
        type: Node,
        displayName: 'Player',
        tooltip: 'Узел игрока.',
    })
    player: Node | null = null;

    @property({
        type: Node,
        displayName: 'View Root',
        tooltip:
            'Ширина экрана (UITransform) для логики, которая от хаба читает размер. На Canvas можно не задавать.',
    })
    viewRoot: Node | null = null;

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
