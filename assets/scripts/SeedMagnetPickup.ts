import { _decorator, Node } from 'cc';
import { BonusItemType } from './BonusItemType';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SoundId } from './SoundLibrary';

const { ccclass } = _decorator;

/**
 * Бонусный магнит на уровне (не путать с {@link MagnetPickable} на семечках).
 * Эффект при сборе — {@link GameManager.grantSeedMagnetPickup}.
 */
@ccclass('SeedMagnetPickup')
export class SeedMagnetPickup extends PickupBase {
    collectSound = SoundId.PickupCollect;

    private _collected = false;

    public override get isCollected(): boolean {
        return this._collected;
    }

    public override get scheduledBonusType(): BonusItemType | null {
        return BonusItemType.Magnet;
    }

    public static resolve(from: Node | null): SeedMagnetPickup | null {
        return PickupBase.resolve(from) as SeedMagnetPickup | null;
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
        gm.grantSeedMagnetPickup();
        this.destroyPickupNode();
    }
}
