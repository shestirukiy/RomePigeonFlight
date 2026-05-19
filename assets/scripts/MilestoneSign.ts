import {
    _decorator,
    BoxCollider2D,
    Collider2D,
    Component,
    Contact2DType,
    IPhysics2DContact,
    Node,
    RigidBody2D,
    Vec3,
} from 'cc';
import { GameManager } from './GameManager';
import { MilestoneDistanceLabel } from './MilestoneDistanceLabel';
import { SceneNodeHub } from './SceneNodeHub';

const { ccclass, property } = _decorator;

/**
 * Столб-веха в чанке: сенсор прохода + вывод метров через MilestoneDistanceLabel.
 */
@ccclass('MilestoneSign')
export class MilestoneSign extends Component {
    @property({
        type: MilestoneDistanceLabel,
        displayName: 'Distance Display',
        tooltip:
            'Компонент с привязанным Label на этом чанке. Перетащите тот же MilestoneDistanceLabel, где настроен ваш Label.',
    })
    distanceDisplay: MilestoneDistanceLabel | null = null;

    @property({
        type: Collider2D,
        displayName: 'Pass Trigger',
        tooltip:
            'Сенсор прохода (Sensor). Пусто — BoxCollider2D на этом узле.',
    })
    passTrigger: Collider2D | null = null;

    private _meters = 0;
    private _consumed = false;
    private _boundCollider: Collider2D | null = null;

    /** На префабе часто только MilestoneDistanceLabel — добавляем логику прохода в рантайме. */
    public static ensureOn(node: Node): MilestoneSign | null {
        if (!node?.isValid) {
            return null;
        }
        let sign = node.getComponent(MilestoneSign);
        if (!sign) {
            sign = node.addComponent(MilestoneSign);
        }
        sign._wireDefaults();
        return sign;
    }

    onLoad() {
        this._wireDefaults();
        this._bindTrigger();
    }

    public get milestoneMeters(): number {
        return this._meters;
    }

    start() {
        this._applyDisplay();
    }

    lateUpdate() {
        this._tickPassByOverlap();
    }

    onDestroy() {
        this._unbindTrigger();
    }

    public setup(meters: number): void {
        this._meters = Math.max(0, Math.floor(meters));
        this._consumed = false;
        this._applyDisplay();
    }

    private _wireDefaults(): void {
        this._resolveDistanceDisplay();
        this._resolvePassTrigger();
        const rb = this.getComponent(RigidBody2D);
        if (rb) {
            rb.enabledContactListener = true;
        }
    }

    private _applyDisplay(): void {
        this._resolveDistanceDisplay();
        this.distanceDisplay?.setMeters(this._meters);
    }

    private _resolvePassTrigger(): void {
        if (this.passTrigger?.isValid) {
            return;
        }
        this.passTrigger = this.getComponent(BoxCollider2D);
    }

    private _resolveDistanceDisplay(): void {
        if (this.distanceDisplay?.isValid) {
            return;
        }
        this.distanceDisplay =
            this.getComponent(MilestoneDistanceLabel) ??
            this.getComponentInChildren(MilestoneDistanceLabel);
    }

    private _bindTrigger(): void {
        const col = this.passTrigger;
        if (!col?.isValid || this._boundCollider === col) {
            return;
        }
        this._unbindTrigger();
        this._boundCollider = col;
        col.on(Contact2DType.BEGIN_CONTACT, this._onBeginContact, this);
    }

    private _unbindTrigger(): void {
        if (!this._boundCollider?.isValid) {
            this._boundCollider = null;
            return;
        }
        this._boundCollider.off(
            Contact2DType.BEGIN_CONTACT,
            this._onBeginContact,
            this,
        );
        this._boundCollider = null;
    }

    /** Вызывается из PlayerPathSensors, коллайдера столба или overlap-проверки. */
    public tryPassFromPlayerContact(): boolean {
        if (this._consumed) {
            return false;
        }
        const gm = GameManager.game;
        if (!gm?.onMilestoneSignPassed(this._meters)) {
            return false;
        }
        this._consumed = true;
        return true;
    }

    /**
     * Статичное тело на скроллящемся чанке часто не даёт BEGIN_CONTACT — проверяем AABB вручную.
     */
    private _tickPassByOverlap(): void {
        if (this._consumed) {
            return;
        }
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }
        const signCol = this.passTrigger ?? this.getComponent(BoxCollider2D);
        if (!signCol?.isValid) {
            return;
        }
        const player = SceneNodeHub.instance?.player;
        if (!player?.isValid) {
            return;
        }
        const playerCol =
            player.getComponent(BoxCollider2D) ??
            player.getComponentInChildren(BoxCollider2D);
        if (!playerCol?.isValid) {
            return;
        }

        const sa = this._boxWorldAabb(signCol);
        const pa = this._boxWorldAabb(playerCol);
        if (!sa || !pa || !this._aabbOverlap(sa, pa)) {
            return;
        }

        const signCx = (sa.xMin + sa.xMax) * 0.5;
        const playerCx = (pa.xMin + pa.xMax) * 0.5;
        if (signCx < playerCx) {
            this.tryPassFromPlayerContact();
        }
    }

    private _onBeginContact(
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ): void {
        if (this._consumed || !this._isPlayerCollider(other)) {
            return;
        }
        this.tryPassFromPlayerContact();
    }

    private _isPlayerCollider(other: Collider2D): boolean {
        const player = SceneNodeHub.instance?.player;
        if (!player?.isValid) {
            return false;
        }
        let n: Node | null = other.node;
        while (n) {
            if (n === player) {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    private _aabbOverlap(
        a: { xMin: number; xMax: number; yMin: number; yMax: number },
        b: { xMin: number; xMax: number; yMin: number; yMax: number },
    ): boolean {
        return (
            a.xMin <= b.xMax &&
            a.xMax >= b.xMin &&
            a.yMin <= b.yMax &&
            a.yMax >= b.yMin
        );
    }

    private _boxWorldAabb(col: Collider2D): {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
    } | null {
        const box = col as BoxCollider2D;
        if (!box?.size) {
            return null;
        }
        const n = col.node;
        const hw = box.size.width * 0.5;
        const hh = box.size.height * 0.5;
        const ox = box.offset.x;
        const oy = box.offset.y;
        const corners = [
            new Vec3(ox - hw, oy - hh, 0),
            new Vec3(ox + hw, oy - hh, 0),
            new Vec3(ox - hw, oy + hh, 0),
            new Vec3(ox + hw, oy + hh, 0),
        ];
        const m = n.worldMatrix;
        const w = new Vec3();
        let xMin = Infinity;
        let xMax = -Infinity;
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const c of corners) {
            Vec3.transformMat4(w, c, m);
            xMin = Math.min(xMin, w.x);
            xMax = Math.max(xMax, w.x);
            yMin = Math.min(yMin, w.y);
            yMax = Math.max(yMax, w.y);
        }
        return { xMin, xMax, yMin, yMax };
    }
}
