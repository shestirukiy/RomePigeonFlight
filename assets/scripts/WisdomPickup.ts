import { _decorator, Node } from 'cc';
import { BonusItemType } from './BonusItemType';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SoundId } from './SoundLibrary';

const { ccclass } = _decorator;

/**
 * Wisdom на уровне. Эффект при сборе — {@link GameManager.grantWisdomPickup}.
 */
@ccclass('WisdomPickup')
export class WisdomPickup extends PickupBase {
    collectSound = SoundId.PickupCollect;

    private _collected = false;

    public override get isCollected(): boolean {
        return this._collected;
    }

    public override get scheduledBonusType(): BonusItemType | null {
        return BonusItemType.Wisdom;
    }

    public static resolve(from: Node | null): WisdomPickup | null {
        return PickupBase.resolve(from) as WisdomPickup | null;
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
        gm.grantWisdomPickup();
        this.destroyPickupNode();
    }
}
