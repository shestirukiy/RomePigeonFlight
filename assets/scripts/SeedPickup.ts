import { _decorator, Component, Node } from 'cc';
import { GameManager } from './GameManager';

const { ccclass, property } = _decorator;

/**
 * Семечко (sensor). Сбор обрабатывается в PlayerPathSensors (коллайдер игрока),
 * здесь — очки и уничтожение ноды.
 */
@ccclass('SeedPickup')
export class SeedPickup extends Component {
    @property({
        displayName: 'Points',
        tooltip: 'Сколько очков даёт одно семечко.',
    })
    points = 1;

    private _collected = false;

    public get isCollected(): boolean {
        return this._collected;
    }

    /** Узел префаба seed (или с компонентом SeedPickup). */
    public static findSeedRoot(from: Node | null): Node | null {
        let n: Node | null = from;
        while (n) {
            if (n.name === 'seed' || n.getComponent(SeedPickup)) {
                return n;
            }
            n = n.parent;
        }
        return null;
    }

    public static resolve(from: Node | null): SeedPickup | null {
        const root = SeedPickup.findSeedRoot(from);
        if (!root) {
            return null;
        }
        return (
            root.getComponent(SeedPickup) ??
            (root.name === 'seed' ? root.addComponent(SeedPickup) : null)
        );
    }

    public collect(): void {
        if (this._collected || !this.node?.isValid) {
            return;
        }
        this._collected = true;
        GameManager.game?.addScore(this.points);
        this.node.destroy();
    }
}
