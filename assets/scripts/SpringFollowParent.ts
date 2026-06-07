import { _decorator, Component, director, Director, Node, Vec3, game } from 'cc';
import { GameManager } from './GameManager';
import { PLAYER_FLIGHT_CCLASS } from './GameSession';

const { ccclass, property } = _decorator;

const G_TARGET = { id: 'Target', name: 'Target' };
const G_SPRING = { id: 'Spring', name: 'Spring' };
const G_LIMITS = { id: 'Limits', name: 'Limits' };

type PlayerFlightPitch = {
    pitchVisual?: Node | null;
};

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
            'За кем тянуться (обычно родитель). Пусто — node.parent. Если указан корень Player, автоматически берётся Fedia/Pigeon с pitch.',
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
        displayName: 'Snap When Still',
        tooltip:
            'Когда хвост почти догнал цель — встать ровно, без дрожания на месте.',
    })
    snapWhenIdle = true;

    @property({
        group: G_LIMITS,
        displayName: 'Still Snap Distance (px)',
        tooltip:
            '«Почти догнал» = ближе этого расстояния (в пикселях). Меньше — жёстче, больше — мягче.',
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
    private readonly _targetWorldPrev = new Vec3();
    /** Собственная world-поза хвоста; не читаем node каждый кадр — иначе parent «съедает» отставание. */
    private readonly _worldPos = new Vec3();
    private readonly _delta = new Vec3();
    private readonly _velocity = new Vec3();

    private _captured = false;
    private _hasTargetPrev = false;

    onEnable() {
        director.on(Director.EVENT_BEFORE_DRAW, this._onBeforeDraw, this);
        if (this.recaptureOnEnable) {
            this.captureRestPose();
        } else if (!this._captured) {
            this.captureRestPose();
        }
        this._velocity.set(0, 0, 0);
        this._hasTargetPrev = false;
    }

    onDisable() {
        director.off(Director.EVENT_BEFORE_DRAW, this._onBeforeDraw, this);
        this.snapToTarget();
    }

    /** Запомнить текущую world-позу в local-space anchor как покой. */
    public captureRestPose(): void {
        const anchor = this._resolveAnchor();
        if (!anchor?.isValid) {
            this._captured = false;
            return;
        }
        this.node.getWorldPosition(this._worldPos);
        anchor.inverseTransformPoint(this._restLocal, this._worldPos);
        this._captured = true;
    }

    /** Сбросить скорость и прилипнуть к номинальной точке. */
    public snapToTarget(): void {
        const anchor = this._resolveAnchor();
        if (!anchor?.isValid || !this._captured) {
            return;
        }
        Vec3.transformMat4(this._targetWorld, this._restLocal, anchor.worldMatrix);
        this._worldPos.set(this._targetWorld);
        this.node.setWorldPosition(this._targetWorld);
        this._velocity.set(0, 0, 0);
        this._hasTargetPrev = false;
    }

    private _onBeforeDraw(): void {
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

        const dt = Math.min(Math.max(game.deltaTime, 0), 0.05);
        Vec3.transformMat4(this._targetWorld, this._restLocal, anchor.worldMatrix);

        let targetMove = 0;
        if (this._hasTargetPrev) {
            targetMove = Vec3.distance(this._targetWorld, this._targetWorldPrev);
        } else {
            this._worldPos.set(this._targetWorld);
            this._hasTargetPrev = true;
        }
        this._targetWorldPrev.set(this._targetWorld);

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
            (this.stiffness * this._delta.x - this.damping * this._velocity.x) * dt;
        this._velocity.y +=
            (this.stiffness * this._delta.y - this.damping * this._velocity.y) * dt;
        this._velocity.z +=
            (this.stiffness * this._delta.z - this.damping * this._velocity.z) * dt;

        if (this.maxSpeed > 0) {
            const speed = this._velocity.length();
            if (speed > this.maxSpeed) {
                this._velocity.multiplyScalar(this.maxSpeed / speed);
            }
        }

        this._worldPos.x += this._velocity.x * dt;
        this._worldPos.y += this._velocity.y * dt;
        this._worldPos.z += this._velocity.z * dt;

        if (this.snapWhenIdle) {
            const eps = this.idleEpsilon;
            const targetStill = targetMove <= eps;
            if (
                targetStill &&
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
        const playerRoot = this._findPlayerRoot();
        const explicit = this.followAnchor?.isValid ? this.followAnchor : null;

        if (explicit) {
            if (playerRoot && explicit === playerRoot) {
                return this._resolvePitchPivot(playerRoot) ?? explicit;
            }
            return explicit;
        }

        if (playerRoot) {
            return this._resolvePitchPivot(playerRoot) ?? this.node.parent;
        }
        return this.node.parent;
    }

    private _findPlayerRoot(): Node | null {
        let n: Node | null = this.node;
        while (n) {
            if (n.getComponent(PLAYER_FLIGHT_CCLASS as never)) {
                return n;
            }
            n = n.parent;
        }
        return null;
    }

    /** Узел с pitch (Fedia/Pigeon), а не корень Player — он не крутится при полёте. */
    private _resolvePitchPivot(playerRoot: Node): Node | null {
        const fedia = playerRoot.getChildByName('Fedia');
        if (fedia?.isValid && fedia.activeInHierarchy) {
            return fedia;
        }
        const flight = playerRoot.getComponent(
            PLAYER_FLIGHT_CCLASS as never,
        ) as PlayerFlightPitch | null;
        if (flight?.pitchVisual?.isValid && flight.pitchVisual.activeInHierarchy) {
            return flight.pitchVisual;
        }
        const pigeon = playerRoot.getChildByName('Pigeon');
        if (pigeon?.isValid) {
            return pigeon;
        }
        return null;
    }
}
