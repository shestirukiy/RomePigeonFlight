import { _decorator, Component, Node, Sprite } from 'cc';

const { ccclass, property } = _decorator;

/**
 * EditorOnly - скрывает ноду/спрайт/детей при запуске игры
 * Используется для placeholder нод, которые нужны только в редакторе
 * Работает как на сцене, так и внутри префабов
 */
@ccclass('EditorOnly')
export class EditorOnly extends Component {

    /** Скрыть саму ноду (node.active = false) */
    @property({ displayName: 'Hide This Node', tooltip: 'Скрыть саму ноду с компонентом (node.active = false)' })
    public hideNode: boolean = true;

    /** Скрыть спрайт ноды (Sprite.enabled = false), не трогая активность ноды */
    @property({ displayName: 'Hide Sprite', tooltip: 'Отключить компонент Sprite на этой ноде (нода остаётся активной)' })
    public hideSprite: boolean = false;

    /** Скрыть всех дочерних нод (child.active = false) */
    @property({ displayName: 'Hide Children', tooltip: 'Скрыть все дочерние ноды (child.active = false)' })
    public hideChildren: boolean = false;

    start() {
        if (this.hideNode) {
            this.node.active = false;
            // Если нода скрыта — остальные опции не имеют смысла
            return;
        }

        if (this.hideSprite) {
            const sprite = this.node.getComponent(Sprite);
            if (sprite) {
                sprite.enabled = false;
            }
        }

        if (this.hideChildren) {
            this.node.children.forEach(child => {
                child.active = false;
            });
        }
    }
}