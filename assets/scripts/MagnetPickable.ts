import {
    _decorator,
    Component,
    ERigidBody2DType,
    Node,
    RigidBody2D,
    Vec3,
} from 'cc';
import { FeatherFloat } from './FeatherFloat';
import { GameManager } from './GameManager';
import { PickupBase } from './PickupBase';
import { SceneNodeHub } from './SceneNodeHub';

const { ccclass, property } = _decorator;

const G_MAGNET = { id: 'Magnet', name: 'Magnet' };
const G_MOTION = { id: 'Motion', name: 'Motion' };

/**
 * Притягивает объект к игроку в радиусе и вызывает PickupBase.collect() при подлёте.
 * Движение в lateUpdate — после FeatherFloat, иначе покачивание затирает сдвиг.
 */
@ccclass('MagnetPickable')
export class MagnetPickable extends Component {
    @property({
        group: G_MAGNET,
        displayName: 'Magnet Radius',
        tooltip: 'Дистанция до игрока (px), с которой начинается притяжение.',
    })
    magnetRadius = 200;

    @property({
        group: G_MAGNET,
        displayName: 'Collect Radius',
        tooltip:
            'Авто-сбор ближе этого радиуса (px). Должен быть меньше Magnet Radius, иначе полёта не видно.',
    })
    collectRadius = 56;

    @property({
        group: G_MOTION,
        displayName: 'Fly Speed',
        tooltip: 'Скорость полёта к игроку (px/s), если Use Smoothing выключен.',
    })
    flySpeed = 720;

    @property({
        group: G_MOTION,
        displayName: 'Use Smoothing',
        tooltip:
            'true — сглаженное движение (экспоненциальный lerp). false — постоянная скорость по прямой.',
    })
    useSmoothing = true;

    @property({
        group: G_MOTION,
        displayName: 'Smooth Rate',
        tooltip: 'Чем больше — быстрее догоняет игрока (только при Use Smoothing).',
        visible() {
            return (this as MagnetPickable).useSmoothing;
        },
    })
    smoothRate = 14;

    @property({
        group: G_MOTION,
        displayName: 'Disable Feather Float',
        tooltip:
            'Выключает FeatherFloat на время притяжения, чтобы покачивание не мешало полёту.',
    })
    disableFeatherFloat = true;

    private _pickup: PickupBase | null = null;
    private _player: Node | null = null;
    private _feather: FeatherFloat | null = null;
    private _rb: RigidBody2D | null = null;
    private _rbWasStatic = false;
    private _attracting = false;

    private static _equippedMagnetActive = false;
    private static _equippedMagnetCenter: Node | null = null;
    private static _equippedMagnetRadius = 0;

    public static setEquippedMagnetZone(center: Node | null, radius: number): void {
        MagnetPickable._equippedMagnetActive =
            !!center?.isValid && radius > 0 && GameManager.game?.isPlaying === true;
        MagnetPickable._equippedMagnetCenter = center;
        MagnetPickable._equippedMagnetRadius = Math.max(0, radius);
    }

    public static clearEquippedMagnetZone(): void {
        MagnetPickable._equippedMagnetActive = false;
        MagnetPickable._equippedMagnetCenter = null;
        MagnetPickable._equippedMagnetRadius = 0;
    }

    private readonly _selfWorld = new Vec3();
    private readonly _playerWorld = new Vec3();
    private readonly _delta = new Vec3();

    onLoad() {
        this._feather = this.getComponent(FeatherFloat);
        this._rb = this.getComponent(RigidBody2D);
        this._clampCollectRadius();
    }

    start() {
        this._pickup = this._findPickup();
        this._player = SceneNodeHub.instance?.player ?? null;
    }

    onEnable() {
        this._attracting = false;
        this._rbWasStatic = false;
        if (this.disableFeatherFloat && this._feather) {
            this._feather.enabled = true;
        }
        if (!this._pickup) {
            this._pickup = this._findPickup();
        }
    }

    lateUpdate(dt: number) {
        if (
            !this.node?.isValid ||
            !this._pickup ||
            this._pickup.isCollected ||
            GameManager.game?.isPlaying !== true
        ) {
            return;
        }

        if (!this._player?.isValid) {
            this._player = SceneNodeHub.instance?.player ?? null;
            if (!this._player?.isValid) {
                return;
            }
        }

        this.node.getWorldPosition(this._selfWorld);
        this._player.getWorldPosition(this._playerWorld);

        Vec3.subtract(this._delta, this._playerWorld, this._selfWorld);
        const dist = this._delta.length();
        const magnetR = Math.max(8, this.magnetRadius);

        if (
            !this._attracting &&
            dist > magnetR &&
            !this._isInsideEquippedMagnetZone()
        ) {
            return;
        }

        if (!this._attracting && this._isInsideEquippedMagnetZone()) {
            this._beginAttraction();
        }

        if (!this._attracting && dist > magnetR) {
            return;
        }

        if (!this._attracting) {
            this._beginAttraction();
        }

        const collectR = Math.min(
            Math.max(8, this.collectRadius),
            magnetR * 0.85,
        );
        if (dist <= collectR) {
            this._pickup.collect();
            return;
        }

        if (this.useSmoothing) {
            const t = 1 - Math.exp(-this.smoothRate * dt);
            Vec3.lerp(
                this._selfWorld,
                this._selfWorld,
                this._playerWorld,
                t,
            );
            this.node.setWorldPosition(this._selfWorld);
            return;
        }

        const step = Math.min(this.flySpeed * dt, Math.max(0, dist - collectR));
        if (step > 1e-5) {
            this._delta.normalize();
            this._selfWorld.x += this._delta.x * step;
            this._selfWorld.y += this._delta.y * step;
            this.node.setWorldPosition(this._selfWorld);
        }
    }

    private _findPickup(): PickupBase | null {
        for (const c of this.node.components) {
            if (c instanceof PickupBase) {
                return c;
            }
        }
        return PickupBase.resolve(this.node);
    }

    private _clampCollectRadius(): void {
        if (this.collectRadius >= this.magnetRadius) {
            this.collectRadius = Math.max(24, this.magnetRadius * 0.35);
        }
    }

    private _beginAttraction(): void {
        this._attracting = true;
        if (this.disableFeatherFloat && this._feather) {
            this._feather.enabled = false;
        }
        if (this._rb?.enabled) {
            this._rbWasStatic = this._rb.type === ERigidBody2DType.Static;
            if (this._rbWasStatic) {
                this._rb.type = ERigidBody2DType.Kinematic;
            }
        }
    }

    private _isInsideEquippedMagnetZone(): boolean {
        if (
            !MagnetPickable._equippedMagnetActive ||
            !MagnetPickable._equippedMagnetCenter?.isValid
        ) {
            return false;
        }
        const center = new Vec3();
        MagnetPickable._equippedMagnetCenter.getWorldPosition(center);
        this.node.getWorldPosition(this._selfWorld);
        Vec3.subtract(this._delta, this._selfWorld, center);
        return this._delta.length() <= MagnetPickable._equippedMagnetRadius;
    }
}
