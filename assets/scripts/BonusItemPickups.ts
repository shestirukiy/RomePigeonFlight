import { Collider2D, Node, RigidBody2D } from 'cc';
import { BonusItemType } from './BonusItemType';
import { PickupBase } from './PickupBase';

export type { BonusItemType };

export interface IScheduledBonusPickup {
    readonly itemType: BonusItemType;
    readonly node: Node;
    deactivate(): void;
    activate(): void;
}

/** Обход дерева вручную — getComponentsInChildren по умолчанию пропускает inactive-ноды. */
export function collectPickupComponents(root: Node | null): PickupBase[] {
    if (!root?.isValid) {
        return [];
    }
    const out: PickupBase[] = [];
    const walk = (node: Node): void => {
        const pickup = node.getComponent(PickupBase);
        if (pickup) {
            out.push(pickup);
        }
        for (const child of node.children) {
            walk(child);
        }
    };
    walk(root);
    return out;
}

export function setScheduledPickupActive(root: Node, active: boolean): void {
    if (!root?.isValid) {
        return;
    }
    root.active = active;
    for (const rb of root.getComponents(RigidBody2D)) {
        rb.enabled = active;
    }
    for (const col of root.getComponents(Collider2D)) {
        col.enabled = active;
    }
    for (const child of root.children) {
        child.active = active;
        for (const rb of child.getComponents(RigidBody2D)) {
            rb.enabled = active;
        }
        for (const col of child.getComponents(Collider2D)) {
            col.enabled = active;
        }
    }
}

class ScheduledBonusPickup implements IScheduledBonusPickup {
    readonly itemType: BonusItemType;
    readonly node: Node;

    constructor(node: Node, itemType: BonusItemType) {
        this.node = node;
        this.itemType = itemType;
    }

    deactivate(): void {
        setScheduledPickupActive(this.node, false);
    }

    activate(): void {
        setScheduledPickupActive(this.node, true);
    }
}

/** Все планируемые бонусы в чанке: *Pickup с scheduledBonusType != null. */
export function collectScheduledPickups(
    chunkRoot: Node | null,
): IScheduledBonusPickup[] {
    if (!chunkRoot?.isValid) {
        return [];
    }

    const out: IScheduledBonusPickup[] = [];
    for (const pickup of collectPickupComponents(chunkRoot)) {
        const type = pickup.scheduledBonusType;
        if (type == null || !pickup.node?.isValid) {
            continue;
        }
        out.push(new ScheduledBonusPickup(pickup.node, type));
    }
    return out;
}

export function deactivateAllScheduledPickups(chunkRoot: Node | null): void {
    for (const entry of collectScheduledPickups(chunkRoot)) {
        entry.deactivate();
    }
}
