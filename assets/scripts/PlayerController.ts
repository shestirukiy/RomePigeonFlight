import { _decorator, Component, Node } from 'cc';
import { GameManager } from './GameManager';
import { PlayerFlight } from './PlayerFlight';
import { PlayerAnimationController } from './PlayerAnimationController';

const { ccclass, property } = _decorator;

/**
 * High-level player state — hazard reactions, forwarded to Flight and AnimationController.
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({
        displayName: 'Electric Lift Lock (s)',
        tooltip:
            'Блокировка подъёма от электричества (сек.). Используется, если на препятствии «Lift Lock Duration» = 0. Иначе длительность задаёт препятствие.',
    })
    electricDefaultLiftLockDuration = 0.5;

    private _flight: PlayerFlight | null = null;
    private _anim: PlayerAnimationController | null = null;

    onLoad() {
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;
        this._anim =
            this.getComponent(PlayerAnimationController) ??
            this.getComponentInChildren(PlayerAnimationController);
    }

    /**
     * Call from obstacle scripts while game is playing.
     */
    receiveElectricDamage(
        liftLockDurationSec?: number,
    ): void {
        if (!GameManager.game?.isPlaying) {
            return;
        }
        const t =
            liftLockDurationSec != null && liftLockDurationSec > 0
                ? liftLockDurationSec
                : this.electricDefaultLiftLockDuration;
        if (t <= 0) {
            return;
        }
        this._flight?.setElectricLiftBlockedFor(t);
        this._anim?.notifyElectricDamage(t);
    }

    /** Walk ancestors from a collider / child node until PlayerController is found. */
    public static findFromColliderNode(start: Node | null): PlayerController | null {
        let n: Node | null = start;
        while (n) {
            const ctrl = n.getComponent(PlayerController);
            if (ctrl) {
                return ctrl;
            }
            n = n.parent;
        }
        return null;
    }
}
