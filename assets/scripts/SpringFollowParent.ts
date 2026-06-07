import { _decorator, Component, Node, Vec3 } from 'cc';
import { GameManager } from './GameManager';

const { ccclass, property } = _decorator;

const G_TARGET = { id: 'Target', name: 'Target' };
const G_SPRING = { id: 'Spring', name: 'Spring' };
const G_LIMITS = { id: 'Limits', name: 'Limits' };

/**
 * Дочерняя нода перестаёт жёстко ехать с родителем: тянется к «номинальной» точке
 * (как если бы была прибита локально), но с инерцией пружины / резинки.
 *
 * Повесьте на child Player (шлем, эффект, UI-иконку). Родитель может двигаться и крутиться —
 * цель пересчитывается каждый кадр из restLocalOffset относительно anchor.
 */
@ccclass('SpringFollowParent')
export class SpringFollowParent extends Component {
    @property({
        group: G_TARGET,
        type: Node,
        displayName: 'Follow Anchor',
        tooltip:
            'За кем тянуться (обычно родитель). Пусто — node.parent. Можно указать другой узел Player.',
    })
    followAnchor: Node | null = null;

    @property({
        group: G_TARGET,
        displayName: 'Recapture On Enable',
        tooltip:
            'При каждом enable заново запомнить текущую local-позу как покой (rest).',
    })
    recaptureOnEnable = true;

    @property({
        group: G_SPRING,
        displayName: 'Stiffness',
        tooltip: 'Жёсткость пружины: выше — быстрее догоняет родителя.',
        min: 0,
        step: 1,
    })
    stiffness = 420;

    @property({
        group: G_SPRING,
        displayName: 'Damping',
        tooltip: 'Затухание: выше — меньше «перелёта» и дрожи.',
        min: 0,
        step: 0.5,
    })
    damping = 28;

    @property({
        group: G_SPRING,
        displayName: 'Max Speed (px/s)',
        tooltip: '0 — без лимита скорости хвоста.',
        min: 0,
    })
    maxSpeed = 0;

    @property({
        group: G_LIMITS,
        displayName: 'Max Stretch (px)',
        tooltip:
            'Макс. отставание от номинальной точки (резинка). 0 — без ограничения.',
        min: 0,
    })
    maxStretch = 0;

    @property({
        group: G_LIMITS,
        displayName: 'Snap When Idle',
        tooltip:
            'Если отставание и скорость почти нулевые — прилипнуть к цели (убирает микродрожь).',
    })
    snapWhenIdle = true;

    @property({
        group: G_LIMITS,
        displayName: 'Idle Epsilon (px)',
        tooltip: 'Порог snapWhenIdle по смещению и скорости.',
        min: 0.01,
        visible(this: SpringFollowParent) {
            return this.snapWhenIdle;
        },
    })
    idleEpsilon = 0.35;

    @property({
        displayName: 'Pause Outside Play',
        tooltip:
            'Вне isPlaying (меню / game over) — держать номинальную позу без пружины.',
    })
    pauseOutsidePlay = true;

    private readonly _restLocal = new Vec3();
    private readonly _targetWorld = new Vec3();
    private readonly _worldPos = new Vec3();
    private readonly _delta = new Vec3();
    private readonly _velocity = new Vec3();

    private _captured = false;

    onEnable() {
        if (this.recaptureOnEnable) {
            this.captureRestPose();
        } else if (!this._captured) {
            this.captureRestPose();
        }
        this._velocity.set(0, 0, 0);
    }

    onDisable() {
        this.snapToTarget();
    }

    /** Запомнить текущую local-позу относительно anchor как покой. */
    public captureRestPose(): void {
        const anchor = this._resolveAnchor();
        if (!anchor?.isValid) {
            this._captured = false;
            return;
        }
        this._restLocal.set(this.node.position);
        this._captured = true;
    }

    /** Сбросить скорость и прилипнуть к номинальной точке. */
    public snapToTarget(): void {
        const anchor = this._resolveAnchor();
        if (!anchor?.isValid || !this._captured) {
            return;
        }
        Vec3.transformMat4(this._targetWorld, this._restLocal, anchor.worldMatrix);
        this.node.setWorldPosition(this._targetWorld);
        this._velocity.set(0, 0, 0);
    }

    lateUpdate(dt: number) {
        if (!this._captured) {
            this.captureRestPose();
        }
        if (!this._captured) {
            return;
        }

        const anchor = this._resolveAnchor();
        if (!anchor?.isValid) {
            return;
        }

        if (this.pauseOutsidePlay && GameManager.game?.isPlaying !== true) {
            this.snapToTarget();
            return;
        }

        const step = Math.min(Math.max(dt, 0), 0.05);
        Vec3.transformMat4(this._targetWorld, this._restLocal, anchor.worldMatrix);
        this.node.getWorldPosition(this._worldPos);

        Vec3.subtract(this._delta, this._targetWorld, this._worldPos);
        if (this.maxStretch > 0) {
            const dist = this._delta.length();
            if (dist > this.maxStretch) {
                this._delta.multiplyScalar(this.maxStretch / dist);
                Vec3.add(this._worldPos, this._targetWorld, this._delta);
                Vec3.subtract(this._delta, this._targetWorld, this._worldPos);
            }
        }

        this._velocity.x +=
            (this.stiffness * this._delta.x - this.damping * this._velocity.x) * step;
        this._velocity.y +=
            (this.stiffness * this._delta.y - this.damping * this._velocity.y) * step;
        this._velocity.z +=
            (this.stiffness * this._delta.z - this.damping * this._velocity.z) * step;

        if (this.maxSpeed > 0) {
            const speed = this._velocity.length();
            if (speed > this.maxSpeed) {
                this._velocity.multiplyScalar(this.maxSpeed / speed);
            }
        }

        this._worldPos.x += this._velocity.x * step;
        this._worldPos.y += this._velocity.y * step;
        this._worldPos.z += this._velocity.z * step;

        if (this.snapWhenIdle) {
            const eps = this.idleEpsilon;
            if (
                this._delta.lengthSqr() <= eps * eps &&
                this._velocity.lengthSqr() <= eps * eps
            ) {
                this._worldPos.set(this._targetWorld);
                this._velocity.set(0, 0, 0);
            }
        }

        this.node.setWorldPosition(this._worldPos);
    }

    private _resolveAnchor(): Node | null {
        if (this.followAnchor?.isValid) {
            return this.followAnchor;
        }
        return this.node.parent;
    }
}
