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
import { PlayerPathSensors } from './PlayerPathSensors';

const { ccclass, property } = _decorator;

/**
 * Только коллизии: отдача, импульс, анимация — в PlayerController (группа «Tower wall»).
 */
@ccclass('TowerWallHazard')
export class TowerWallHazard extends Component {
    @property({
        displayName: 'Debug Contact Log',
    })
    debugContactLog = false;

    private _coolRemain = 0;

    private _registeredColliders: Collider2D[] = [];

    update(dt: number) {
        if (this._coolRemain > 0) {
            this._coolRemain -= dt;
        }
    }

    onLoad() {
        this._bindColliders();
    }

    start() {
        if (this._registeredColliders.length === 0) {
            this._bindColliders();
        }
    }

    private _bindColliders(): void {
        this._unbindColliders();
        const colliders: Collider2D[] = [];
        try {
            colliders.push(...this.node.getComponents(Collider2D));
            colliders.push(...this.node.getComponentsInChildren(Collider2D));
        } catch {
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
        if (PlayerPathSensors.hazardsViaPlayerContact) {
            return;
        }
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }

        // Если отскок уже идёт и мы упёрлись во что-то ещё — обнуляем импульс отдачи.
        if (gm.isWorldKickbackActive) {
            gm.cancelWorldKickback();
        }

        if (this._coolRemain > 0) {
            return;
        }
        const pc = PlayerController.findFromColliderNode(otherCollider.node);
        if (!pc) {
            return;
        }
        if (this.debugContactLog) {
            console.log('[TowerWallHazard] hit', otherCollider.node?.name);
        }

        pc.applyTowerWallHit();
        this._coolRemain = Math.max(
            pc.towerWallCooldownSeconds,
            pc.towerWallKnockbackDurationSec,
        );
    }
}
