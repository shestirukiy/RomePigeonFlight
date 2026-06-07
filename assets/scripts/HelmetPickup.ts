import { _decorator, Node } from 'cc';
import { BonusItemType } from './BonusItemType';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SoundId } from './SoundLibrary';

const { ccclass } = _decorator;

/**
 * Шлем на уровне. Один шлем на игрока; повторный сбор заменяет предыдущий.
 * Эффект — {@link GameManager.grantHelmetPickup}.
 */
@ccclass('HelmetPickup')
export class HelmetPickup extends PickupBase {
    collectSound = SoundId.None;

    private _collected = false;

    public override get isCollected(): boolean {
        return this._collected;
    }

    public override get scheduledBonusType(): BonusItemType | null {
        return BonusItemType.Helmet;
    }

    public static resolve(from: Node | null): HelmetPickup | null {
        return PickupBase.resolve(from) as HelmetPickup | null;
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
        gm.grantHelmetPickup();
        this.destroyPickupNode();
    }
}
