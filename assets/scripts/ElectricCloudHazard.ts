import {
    _decorator,
    Component,
    Collider2D,
    Contact2DType,
    IPhysics2DContact,
    Node,
    RigidBody2D,
} from 'cc';
import { GameManager } from './GameManager';
import { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

/**
 * @deprecated Урон — sensor на CloudBarrier + {@link PlayerPathSensors}.
 */
@ccclass('ElectricCloudHazard')
export class ElectricCloudHazard extends Component {
    @property({
        displayName: 'Debug Contact Log',
        tooltip:
            'В консоль: BEGIN_CONTACT и поиск PlayerController.',
    })
    debugContactLog = false;

    private _coolRemain = 0;

    /** Заполняется в onLoad — в onDestroy не вызываем getComponentsInChildren (в редакторе узел уже частично разобран → null.length). */
    private _registeredColliders: Collider2D[] = [];

    update(dt: number) {
        if (this._coolRemain > 0) {
            this._coolRemain -= dt;
        }
    }

    onLoad() {
        this.enabled = false;
    }

    start() {
        if (!this.enabled) {
            return;
        }
        if (this._registeredColliders.length === 0) {
            this._bindColliders();
        }
    }

    /** Не вешать на SkyGround / SkySensor — только префаб CloudBarrier. */
    private _isUnderCloudBarrier(): boolean {
        let n: Node | null = this.node;
        while (n) {
            if (n.name === 'CloudBarrier') {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    private _bindColliders(): void {
        this._unbindColliders();
        const colliders: Collider2D[] = [];
        try {
            colliders.push(...this.node.getComponents(Collider2D));
            colliders.push(...this.node.getComponentsInChildren(Collider2D));
        } catch {
            if (this.debugContactLog) {
                console.warn(
                    '[ElectricCloudHazard] Failed to collect colliders on',
                    this.node?.name,
                );
            }
            return;
        }
        const uniq = [...new Set(colliders)];
        for (const col of uniq) {
            if (!col?.isValid) {
                continue;
            }
            const rb = col.getComponent(RigidBody2D);
            if (rb) {
                rb.enabledContactListener = true;
            }
            this._registeredColliders.push(col);
            col.on(
                Contact2DType.BEGIN_CONTACT,
                this._onBeginContact,
                this,
            );
        }
        if (this.debugContactLog) {
            console.log(
                `[ElectricCloudHazard] "${this.node.name}" registered ${this._registeredColliders.length} Collider2D`,
            );
        }
    }

    private _unbindColliders(): void {
        for (const col of this._registeredColliders) {
            if (col?.isValid) {
                col.off(
                    Contact2DType.BEGIN_CONTACT,
                    this._onBeginContact,
                    this,
                );
            }
        }
        this._registeredColliders.length = 0;
    }

    onDestroy() {
        this._unbindColliders();
    }

    private _onBeginContact(
        selfCollider: Collider2D,
        otherCollider: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        return;
        const otherName = otherCollider?.node?.name ?? '?';
        if (this.debugContactLog) {
            console.log(
                `[ElectricCloudHazard] BEGIN_CONTACT self="${selfCollider?.node?.name}" other="${otherName}" playing=${GameManager.game?.isPlaying === true}`,
            );
        }
        if (!GameManager.game?.isPlaying) {
            return;
        }
        if (this._coolRemain > 0) {
            if (this.debugContactLog) {
                console.log('[ElectricCloudHazard] skipped (cooldown)');
            }
            return;
        }
        const pc = PlayerController.findFromColliderNode(otherCollider.node);
        if (!pc) {
            if (this.debugContactLog) {
                console.log(
                    '[ElectricCloudHazard] no PlayerController on other branch:',
                    otherName,
                );
            }
            return;
        }
        if (this.debugContactLog) {
            console.log('[ElectricCloudHazard] → applyElectricCloudHit');
        }
        pc.applyElectricCloudHit();
        this._coolRemain = Math.max(
            pc.electricCloudCooldownSeconds,
            pc.electricDefaultLiftLockDuration,
        );
    }
}
