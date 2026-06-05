import { _decorator, Node } from 'cc';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SceneNodeHub } from './SceneNodeHub';
import { SoundId } from './SoundLibrary';

const { ccclass } = _decorator;

/**
 * Сердечко на уровне. Сбор сразу даёт +1 HP — тот же эффект, что при наборе
 * seedsPerExtraLife семечек (HpHarvest + «+1 Life restored»).
 * Коллайдер игрока (PlayerPathSensors) и/или MagnetPickable.
 */
@ccclass('LifePickup')
export class LifePickup extends PickupBase {
    collectSound = SoundId.PickupCollect;

    private _collected = false;

    public override get isCollected(): boolean {
        return this._collected;
    }

    /** @deprecated Используйте PickupBase.resolve */
    public static resolve(from: Node | null): LifePickup | null {
        return PickupBase.resolve(from) as LifePickup | null;
    }

    public override collect(): void {
        if (this._collected || !this.node?.isValid) {
            return;
        }
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }
        this._collected = true;
        this.playCollectSound();
        if (gm.grantExtraLifeWithHarvest()) {
            SceneNodeHub.instance?.showLifeRestored();
        }
        this.destroyPickupNode();
    }
}
