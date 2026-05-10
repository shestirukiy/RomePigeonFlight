import { _decorator, Component, Node, Vec3 } from 'cc';
import { SceneNodeHub } from './SceneNodeHub';

const { ccclass, property } = _decorator;

/**
 * Держит узел камеры над целью: при отдаче игрока камера едет вместе с ним.
 * Повесь на узел с Camera; Follow Target — корень Player (тот же узел, что двигает knockback).
 */
@ccclass('CameraFollowTarget')
export class CameraFollowTarget extends Component {
    @property({
        type: Node,
        displayName: 'Follow Target',
        tooltip:
            'Пусто — берётся Scene Node Hub → Player. Иначе явный узел (корень Player с RigidBody2D).',
    })
    followTarget: Node | null = null;

    @property({
        displayName: 'Position Offset',
        tooltip: 'Сдвиг камеры относительно цели в мировых координатах (если кадр уехал — подстройте).',
    })
    worldOffset = new Vec3(0, 0, 0);

    lateUpdate() {
        const hub = SceneNodeHub.instance;
        let target = this.followTarget;
        if (!target?.isValid) {
            target = hub?.player ?? null;
        }
        if (!target?.isValid) {
            return;
        }
        const t = target.worldPosition;
        const o = this.worldOffset;
        const z = this.node.worldPosition.z;
        this.node.setWorldPosition(t.x + o.x, t.y + o.y, z + o.z);
    }
}
