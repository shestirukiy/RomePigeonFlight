import {
    _decorator,
    Component,
    Collider2D,
    Contact2DType,
    IPhysics2DContact,
    RigidBody2D,
} from 'cc';
import { GameManager } from './GameManager';
import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

/**
 * Attach to obstacle root (chunk). Registers BEGIN_CONTACT on this node and every child Collider2D.
 */
@ccclass('ElectricCloudHazard')
export class ElectricCloudHazard extends Component {
    @property({
        displayName: 'Lift Lock Duration (s)',
        tooltip:
            '0 — брать длительность с Player → Electric Lift Lock (s). Иначе своё значение (сек.), перекрывает инспектор игрока.',
    })
    liftLockDuration = 0;

    @property({
        displayName: 'Trigger Cooldown (s)',
        tooltip:
            'Минимум между ударами с этого препятствия (ребро коллайдеров может дёргать несколько раз).',
    })
    cooldownSeconds = 0.55;

    @property({
        displayName: 'Debug Contact Log',
        tooltip:
            'В консоль: любой BEGIN_CONTACT и результат поиска PlayerController.',
    })
    debugContactLog = true;

    private _coolRemain = 0;

    /** Заполняется в onLoad — в onDestroy не вызываем getComponentsInChildren (в редакторе узел уже частично разобран → null.length). */
    private _registeredColliders: Collider2D[] = [];

    update(dt: number) {
        if (this._coolRemain > 0) {
            this._coolRemain -= dt;
        }
    }

    onLoad() {
        this._registeredColliders = [];
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
            // Иначе BEGIN_CONTACT не приходит: см. RigidBody2D.enabledContactListener в мануале Physics 2D.
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

    onDestroy() {
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

    private _onBeginContact(
        selfCollider: Collider2D,
        otherCollider: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
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
            console.log('[ElectricCloudHazard] → receiveElectricDamage');
        }
        const lockSec =
            this.liftLockDuration > 0
                ? this.liftLockDuration
                : pc.electricDefaultLiftLockDuration;
        pc.receiveElectricDamage(lockSec);
        this._coolRemain = Math.max(this.cooldownSeconds, lockSec);
    }
}
