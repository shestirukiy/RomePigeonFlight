import {
    _decorator,
    Component,
    Collider2D,
    BoxCollider2D,
    Contact2DType,
    IPhysics2DContact,
    RigidBody2D,
    ERigidBody2DType,
    Vec3,
} from 'cc';
import { GameManager } from './GameManager';
import { PlayerAnimationController } from './PlayerAnimationController';

const { ccclass, property, executionOrder } = _decorator;

/** Раньше LevelGenerator.update — после шага физики синхронизируем блокировки скролла. */
const PATH_SENSORS_EXEC_ORDER = -50;

/**
 * Коллайдер игрока + контакты (не sensor): по центрам AABB сравниваем вертикаль и горизонталь.
 * Сверху — игнор. Снизу — только анимация «поверхность», скролл не стоп. Сбоку — вперёд/назад как раньше.
 */
@ccclass('PlayerPathSensors')
@executionOrder(PATH_SENSORS_EXEC_ORDER)
export class PlayerPathSensors extends Component {
    @property({
        type: Collider2D,
        displayName: 'Path Collider',
        tooltip:
            'Обычно корневой BoxCollider2D игрока. Пусто — берём BoxCollider2D с этой ноды.',
    })
    pathCollider: Collider2D | null = null;

    @property({
        displayName: 'Side dead zone X (px)',
        tooltip:
            'Центры игрока и препятствия по X: внутри ±зоны — лобовой контакт («вперёд» для скролла).',
    })
    pathSideDeadZonePx = 24;

    @property({
        displayName: 'Vertical dead zone (px)',
        tooltip:
            'Разница центров по Y: выше зоны — препятствие «сверху» (без реакции). ' +
            'Ниже зоны — «снизу» (бег по поверхности). Иначе — боковой контакт (стоп скролла вперёд/назад).',
    })
    pathVerticalDeadZonePx = 32;

    @property({
        displayName: 'Obstacle Group',
        tooltip:
            'Группа коллайдеров-препятствий.\n' +
            '-1 — любой твёрдый коллайдер (Sensor=false) вне игрока.',
    })
    obstacleGroup = -1;

    @property({
        displayName: 'Surface run activation delay (s)',
        tooltip:
            'Непрерывный контакт «снизу» должен длиться не меньше этого времени, чтобы включить анимацию бега. ' +
            'Короткие касания игнорируются. 0 — без задержки.',
    })
    surfaceRunActivationDelaySec = 0.12;

    @property({
        displayName: 'Debug Log',
        tooltip: 'Контакты и счётчики блокировок.',
    })
    debugLog = false;

    private static readonly _PRUNE_AABB_EPS = 2;

    private _frontCount = 0;
    private _backCount = 0;
    private _belowCount = 0;

    private readonly _frontWalls = new Map<string, Collider2D>();
    private readonly _backWalls = new Map<string, Collider2D>();
    private readonly _belowWalls = new Map<string, Collider2D>();

    private _resolvedPathCollider: Collider2D | null = null;

    private _anim: PlayerAnimationController | null = null;

    /** Накопление времени при непрерывном контакте снизу (для отложенного включения бега). */
    private _surfaceHoldAccumSec = 0;

    public get isFrontBlocked(): boolean {
        return this._frontCount > 0;
    }

    public get isBackBlocked(): boolean {
        return this._backCount > 0;
    }

    /** Есть контакт с поверхностью снизу (бег по земле/платформе). */
    public get isOnSurfaceBelow(): boolean {
        return this._belowCount > 0;
    }

    onLoad() {
        const probe =
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D) ??
            this.node.getComponent(Collider2D);
        this._resolvedPathCollider = probe;

        this._anim =
            this.getComponent(PlayerAnimationController) ??
            this.getComponentInChildren(PlayerAnimationController);

        this._frontCount = 0;
        this._backCount = 0;
        this._belowCount = 0;
        this._frontWalls.clear();
        this._backWalls.clear();
        this._belowWalls.clear();

        if (this.debugLog) {
            console.log(
                '[PlayerPathSensors] onLoad',
                'node=',
                this.node?.name,
                'pathCollider=',
                probe?.node?.name ?? 'null',
                'obstacleGroup=',
                this.obstacleGroup,
            );
        }

        this._bindPathCollider(probe);
    }

    update(_dt: number) {
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            if (
                this._frontCount > 0 ||
                this._backCount > 0 ||
                this._belowCount > 0 ||
                this._surfaceHoldAccumSec > 0
            ) {
                this._frontCount = 0;
                this._backCount = 0;
                this._belowCount = 0;
                this._surfaceHoldAccumSec = 0;
                this._frontWalls.clear();
                this._backWalls.clear();
                this._belowWalls.clear();
                this._anim?.setRunningOnSurface(false);
            }
            return;
        }
        this._pruneStaleWalls(true);
        this._pruneStaleWalls(false);
        this._pruneStaleBelow();
        gm.syncPathSensorBlockCounts(this._frontCount, this._backCount);

        this._updateSurfaceRunAnimation(_dt);
    }

    /** Бег по поверхности только после непрерывного контакта снизу (исключаем короткие касания). */
    private _updateSurfaceRunAnimation(dt: number): void {
        const hasBelow = this._belowCount > 0;
        if (!hasBelow) {
            this._surfaceHoldAccumSec = 0;
            this._anim?.setRunningOnSurface(false);
            return;
        }
        const minSec = this.surfaceRunActivationDelaySec;
        if (minSec <= 0) {
            this._anim?.setRunningOnSurface(true);
            return;
        }
        this._surfaceHoldAccumSec += dt;
        if (this._surfaceHoldAccumSec >= minSec) {
            this._anim?.setRunningOnSurface(true);
        }
    }

    onDestroy() {
        this._unbind(this._resolvedPathCollider);
    }

    private _bindPathCollider(probe: Collider2D | null): void {
        if (!probe?.isValid) {
            if (this.debugLog) {
                console.warn('[PlayerPathSensors] нет path-коллайдера на игроке');
            }
            return;
        }

        let rb = probe.getComponent(RigidBody2D);
        if (!rb) {
            rb = probe.node.addComponent(RigidBody2D);
            rb.type = ERigidBody2DType.Kinematic;
            rb.fixedRotation = true;
        }
        rb.enabledContactListener = true;

        if (this.debugLog) {
            console.log(
                '[PlayerPathSensors] bind path',
                probe.node?.name,
                'deadZone=',
                this.pathSideDeadZonePx,
            );
        }

        probe.on(
            Contact2DType.BEGIN_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onBeginContact(self, other, c),
            this,
        );
        probe.on(
            Contact2DType.END_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onEndContact(self, other, c),
            this,
        );
    }

    private _unbind(collider: Collider2D | null): void {
        if (!collider?.isValid) {
            return;
        }
        collider.off(Contact2DType.BEGIN_CONTACT);
        collider.off(Contact2DType.END_CONTACT);
    }

    /** Центр AABB коллайдера в мире (для BoxCollider2D). */
    private _worldCenter2D(col: Collider2D): { x: number; y: number } | null {
        const a = this._boxWorldAabb(col);
        if (!a) {
            return null;
        }
        return {
            x: (a.xMin + a.xMax) * 0.5,
            y: (a.yMin + a.yMax) * 0.5,
        };
    }

    /** Вертикальное положение препятствия относительно игрока. */
    private _verticalBand(other: Collider2D): 'above' | 'below' | 'side' {
        const selfCol =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const pc = selfCol ? this._worldCenter2D(selfCol) : null;
        const wc = this._worldCenter2D(other);
        if (!pc || !wc) {
            return 'side';
        }
        const dy = wc.y - pc.y;
        const dz = this.pathVerticalDeadZonePx;
        if (dy > dz) {
            return 'above';
        }
        if (dy < -dz) {
            return 'below';
        }
        return 'side';
    }

    /** Стена правее игрока по X → «вперёд» (скролл стоп). Только для бокового контакта. */
    private _wallBlocksForward(other: Collider2D): boolean {
        const px = this.node.worldPosition.x;
        const wx = other.node.worldPosition.x;
        const dz = this.pathSideDeadZonePx;
        const d = wx - px;
        if (Math.abs(d) <= dz) {
            return true;
        }
        return d > 0;
    }

    private _onBeginContact(
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        if (!this._isBlockingObstacle(other)) {
            return;
        }
        const id = this._colliderId(other);
        if (!id) {
            return;
        }

        const v = this._verticalBand(other);
        if (v === 'above') {
            if (this.debugLog) {
                console.log(
                    `[PlayerPathSensors] BEGIN TOP (ignored) other="${other?.node?.name ?? '?'}"`,
                );
            }
            return;
        }
        if (v === 'below') {
            if (this._belowWalls.has(id)) {
                return;
            }
            this._belowWalls.set(id, other);
            this._belowCount++;
            if (this.debugLog) {
                console.log(
                    `[PlayerPathSensors] BEGIN BELOW (surface) other="${other?.node?.name ?? '?'}" below=${this._belowCount}`,
                );
            }
            return;
        }

        const forward = this._wallBlocksForward(other);
        if (forward) {
            if (this._frontWalls.has(id)) {
                return;
            }
            this._frontWalls.set(id, other);
            this._frontCount++;
        } else {
            if (this._backWalls.has(id)) {
                return;
            }
            this._backWalls.set(id, other);
            this._backCount++;
        }
        if (this.debugLog) {
            console.log(
                `[PlayerPathSensors] BEGIN ${forward ? 'FRONT' : 'BACK'} other="${other?.node?.name ?? '?'}"`,
            );
            console.log(
                '[PlayerPathSensors] blocked counts',
                'front=',
                this._frontCount,
                'back=',
                this._backCount,
            );
        }
    }

    private _onEndContact(_self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) {
        const id = other?.isValid ? this._colliderId(other) : '';
        const ok = other?.isValid && this._isBlockingObstacle(other);
        let changed = false;
        if (id && this._frontWalls.delete(id)) {
            this._frontCount = Math.max(0, this._frontCount - 1);
            changed = true;
        } else if (id && this._backWalls.delete(id)) {
            this._backCount = Math.max(0, this._backCount - 1);
            changed = true;
        } else if (id && this._belowWalls.delete(id)) {
            this._belowCount = Math.max(0, this._belowCount - 1);
            changed = true;
        }
        if (this.debugLog && ok && changed) {
            console.log(`[PlayerPathSensors] END other="${other?.node?.name ?? '?'}"`);
            console.log(
                '[PlayerPathSensors] blocked counts',
                'front=',
                this._frontCount,
                'back=',
                this._backCount,
                'below=',
                this._belowCount,
            );
        }
    }

    private _colliderId(other: Collider2D): string {
        return (other as any).uuid ?? other.node?.uuid ?? '';
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

    private _pruneStaleWalls(isFront: boolean): void {
        const probe =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const map = isFront ? this._frontWalls : this._backWalls;
        if (!probe?.isValid || map.size === 0) {
            return;
        }
        const saRaw = this._boxWorldAabb(probe);
        if (!saRaw) {
            return;
        }
        const eps = PlayerPathSensors._PRUNE_AABB_EPS;
        const sa = {
            xMin: saRaw.xMin - eps,
            xMax: saRaw.xMax + eps,
            yMin: saRaw.yMin - eps,
            yMax: saRaw.yMax + eps,
        };
        const toRemove: string[] = [];
        for (const [id, wall] of map) {
            if (!wall?.isValid || !wall.node?.isValid) {
                toRemove.push(id);
                continue;
            }
            const wa = this._boxWorldAabb(wall);
            if (!wa) {
                continue;
            }
            if (!this._aabbOverlap(sa, wa)) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            if (!map.delete(id)) {
                continue;
            }
            if (isFront) {
                this._frontCount = Math.max(0, this._frontCount - 1);
                if (this.debugLog) {
                    console.log(
                        '[PlayerPathSensors] prune FRONT stale wall id=',
                        id,
                        'frontCount=',
                        this._frontCount,
                    );
                }
            } else {
                this._backCount = Math.max(0, this._backCount - 1);
                if (this.debugLog) {
                    console.log(
                        '[PlayerPathSensors] prune BACK stale wall id=',
                        id,
                        'backCount=',
                        this._backCount,
                    );
                }
            }
        }
    }

    private _pruneStaleBelow(): void {
        const probe =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const map = this._belowWalls;
        if (!probe?.isValid || map.size === 0) {
            return;
        }
        const saRaw = this._boxWorldAabb(probe);
        if (!saRaw) {
            return;
        }
        const eps = PlayerPathSensors._PRUNE_AABB_EPS;
        const sa = {
            xMin: saRaw.xMin - eps,
            xMax: saRaw.xMax + eps,
            yMin: saRaw.yMin - eps,
            yMax: saRaw.yMax + eps,
        };
        const toRemove: string[] = [];
        for (const [id, wall] of map) {
            if (!wall?.isValid || !wall.node?.isValid) {
                toRemove.push(id);
                continue;
            }
            const wa = this._boxWorldAabb(wall);
            if (!wa) {
                continue;
            }
            if (!this._aabbOverlap(sa, wa)) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            if (!map.delete(id)) {
                continue;
            }
            this._belowCount = Math.max(0, this._belowCount - 1);
            if (this.debugLog) {
                console.log(
                    '[PlayerPathSensors] prune BELOW stale id=',
                    id,
                    'belowCount=',
                    this._belowCount,
                );
            }
        }
    }

    private _isBlockingObstacle(other: Collider2D): boolean {
        if (!other?.isValid) {
            return false;
        }
        const otherAny = other as any;
        const isOtherSensor = otherAny.sensor === true || otherAny._sensor === true;
        if (isOtherSensor) {
            return false;
        }
        const otherNode = other.node;
        if (otherNode === this.node || otherNode.isChildOf(this.node)) {
            return false;
        }
        if (this.obstacleGroup < 0) {
            return true;
        }
        const g = (other as any).group ?? (other as any)._group;
        return g === this.obstacleGroup;
    }
}
