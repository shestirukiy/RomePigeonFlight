import { _decorator, Component, Node } from 'cc';

const { ccclass } = _decorator;

/**
 * Базовый пикап: очки/эффект и уничтожение ноды.
 * Магнит и коллайдер игрока вызывают collect().
 */
@ccclass('PickupBase')
export abstract class PickupBase extends Component {
    public abstract get isCollected(): boolean;

    public abstract collect(): void;

    /** Корень объекта с PickupBase (подъём по иерархии). */
    public static findPickupRoot(from: Node | null): Node | null {
        let n: Node | null = from;
        while (n) {
            if (n.getComponent(PickupBase)) {
                return n;
            }
            n = n.parent;
        }
        return null;
    }

    public static resolve(from: Node | null): PickupBase | null {
        const root = PickupBase.findPickupRoot(from);
        if (!root) {
            return null;
        }
        return root.getComponent(PickupBase);
    }
}
