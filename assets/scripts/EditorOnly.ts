import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * EditorOnly - скрывает все дочерние элементы при запуске
 * Используется для placeholder нод, которые нужны только в редакторе
 */
@ccclass('EditorOnly')
export class EditorOnly extends Component {

    // === Скрывать при запуске ===
    @property
    public hideOnStart: boolean = true;

    start() {
        if (this.hideOnStart) {
            this.node.children.forEach(child => {
                child.active = false;
            });
        }
    }
}