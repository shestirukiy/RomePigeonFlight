import { _decorator, Node } from 'cc';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SoundId } from './SoundLibrary';

const { ccclass, property } = _decorator;

/**
 * Семечко. Сбор: коллайдер игрока (PlayerPathSensors) и/или MagnetPickable.
 */
@ccclass('SeedPickup')
export class SeedPickup extends PickupBase {
    @property({
        displayName: 'Points',
        tooltip: 'Сколько очков даёт одно семечко.',
    })
    points = 1;

    collectSound = SoundId.SeedCollect;

    private _collected = false;

    public override get isCollected(): boolean {
        return this._collected;
    }

    /** @deprecated Используйте PickupBase.findPickupRoot */
    public static findSeedRoot(from: Node | null): Node | null {
        return PickupBase.findPickupRoot(from);
    }

    /** @deprecated Используйте PickupBase.resolve */
    public static resolve(from: Node | null): SeedPickup | null {
        return PickupBase.resolve(from) as SeedPickup | null;
    }

    public override collect(): void {
        if (this._collected || !this.node?.isValid) {
            return;
        }
        this._collected = true;
        this.playCollectSound();
        GameManager.game?.addScore(this.points);
        this.node.destroy();
    }
}
