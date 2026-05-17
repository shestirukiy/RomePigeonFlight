import { _decorator, Component, Enum, Node } from 'cc';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';

const { ccclass, property } = _decorator;

/**
 * Базовый пикап: очки/эффект и уничтожение ноды.
 * Магнит и коллайдер игрока вызывают collect().
 */
@ccclass('PickupBase')
export abstract class PickupBase extends Component {
    @property({
        type: Enum(SoundId),
        displayName: 'Collect Sound',
        tooltip: 'Звук при collect(). None — без звука.',
    })
    collectSound = SoundId.None;

    public abstract get isCollected(): boolean;

    public abstract collect(): void;

    protected playCollectSound(): void {
        if (this.collectSound === SoundId.None) {
            return;
        }
        SoundController.instance?.play(this.collectSound);
    }

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
