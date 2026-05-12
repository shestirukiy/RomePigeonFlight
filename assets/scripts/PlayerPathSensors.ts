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

const { ccclass, property, executionOrder } = _decorator;

/** Раньше LevelGenerator.update — после шага физики синхронизируем блокировки скролла. */
const PATH_SENSORS_EXEC_ORDER = -50;

/**
 * Либо два дочерних сенсора Front/Back, либо один коллайдер на корне (режим probe):
 * стена правее игрока по X → блок «вперёд», левее → блок «назад».
 * Карта препятствий + sync в GameManager как раньше.
 */
@ccclass('PlayerPathSensors')
@executionOrder(PATH_SENSORS_EXEC_ORDER)
export class PlayerPathSensors extends Component {
    @property({
        displayName: 'Use Body Collider Probe',
        tooltip:
            'Вкл.: один коллайдер на игроке (по умолчанию BoxCollider2D на этой ноде). ' +
            'Направление блока по world X относительно игрока; отдельные Front/Back не используются.',
    })
    useBodyColliderProbe = false;

    @property({
        type: Collider2D,
        displayName: 'Body Probe Collider',
        tooltip:
            'Коллайдер для контактов (обычно корневой BoxCollider2D игрока). Пусто — берём BoxCollider2D с этой ноды.',
    })
    bodyProbeCollider: Collider2D | null = null;

    @property({
        displayName: 'Probe dead zone (px)',
        tooltip:
            'Если центр стены по X попадает в ±зону относительно игрока — считаем «вперёд» ' +
            '(лобовой контакт без двусмысленности сторон).',
    })
    pathProbeDeadZonePx = 24;

    @property({
        type: Collider2D,
        displayName: 'Front Sensor',
        tooltip: 'Сенсор спереди (по ходу движения мира влево).',
    })
    frontSensor: Collider2D | null = null;

    @property({
        type: Collider2D,
        displayName: 'Back Sensor',
        tooltip: 'Сенсор сзади (для отскока, когда мир едет вправо).',
    })
    backSensor: Collider2D | null = null;

    @property({
        displayName: 'Obstacle Group',
        tooltip:
            'Группа коллайдеров, которые считаем “непроходимыми”.\n' +
            'Если поставить -1, то будет блокировать от ЛЮБОГО твёрдого коллайдера (Sensor=false) вне игрока.',
    })
    obstacleGroup = -1;

    @property({
        displayName: 'Debug Log',
        tooltip:
            'Пишет в консоль контакты сенсоров и причины фильтрации (почему блокирует/не блокирует).',
    })
    debugLog = false;

    private static readonly _PRUNE_AABB_EPS = 2;

    private _frontCount = 0;
    private _backCount = 0;

    /** Активные «стены» по uuid коллайдера — если END не пришёл (уничтожение чанка, отрыв по Y), снимаем в prune в update. */
    private readonly _frontWalls = new Map<string, Collider2D>();
    private readonly _backWalls = new Map<string, Collider2D>();

    public get isFrontBlocked(): boolean {
        return this._frontCount > 0;
    }

    public get isBackBlocked(): boolean {
        return this._backCount > 0;
    }

    onLoad() {
        if (!this.frontSensor) {
            const n = this.node.getChildByName('FrontSensor');
            this.frontSensor = n?.getComponent(Collider2D) ?? null;
        }
        if (!this.backSensor) {
            const n = this.node.getChildByName('BackSensor');
            this.backSensor = n?.getComponent(Collider2D) ?? null;
        }

        this._frontCount = 0;
        this._backCount = 0;
        this._frontWalls.clear();
        this._backWalls.clear();

        if (this.debugLog) {
            console.log(
                '[PlayerPathSensors] onLoad',
                'node=',
                this.node?.name,
                'front=',
                this.frontSensor?.node?.name ?? 'null',
                'back=',
                this.backSensor?.node?.name ?? 'null',
                'obstacleGroup=',
                this.obstacleGroup,
            );
        }

        if (this.useBodyColliderProbe) {
            const probe =
                this.bodyProbeCollider ??
                this.node.getComponent(BoxCollider2D) ??
                this.node.getComponent(Collider2D);
            this._bindProbe(probe);
        } else {
            this._bind(this.frontSensor, true);
            this._bind(this.backSensor, false);
        }
    }

    update(_dt: number) {
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }
        this._pruneStaleWalls(true);
        this._pruneStaleWalls(false);
        gm.syncPathSensorBlockCounts(this._frontCount, this._backCount);
    }

    onDestroy() {
        if (this.useBodyColliderProbe) {
            this._unbind(this.bodyResolvedProbe);
        } else {
            this._unbind(this.frontSensor);
            this._unbind(this.backSensor);
        }
    }

    /** Фактически привязанный коллайдер в режиме probe — для off в onDestroy. */
    private bodyResolvedProbe: Collider2D | null = null;

    private _bindProbe(probe: Collider2D | null): void {
        this.bodyResolvedProbe = probe;
        if (!probe?.isValid) {
            if (this.debugLog) {
                console.warn('[PlayerPathSensors] body probe mode: нет коллайдера на игроке');
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
                '[PlayerPathSensors] bind BODY PROBE',
                probe.node?.name,
                'deadZone=',
                this.pathProbeDeadZonePx,
            );
        }

        probe.on(
            Contact2DType.BEGIN_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onProbeBegin(self, other, c),
            this,
        );
        probe.on(
            Contact2DType.END_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onProbeEnd(self, other, c),
            this,
        );
    }

    /**
     * Центр препятствия по X для сравнения с игроком (узел коллайдера стены).
     */
    private _wallSideIsFront(other: Collider2D): boolean {
        const px = this.node.worldPosition.x;
        const wx = other.node.worldPosition.x;
        const dz = this.pathProbeDeadZonePx;
        const d = wx - px;
        if (Math.abs(d) <= dz) {
            return true;
        }
        return d > 0;
    }

    private _onProbeBegin(
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        const ok = this._isBlockingObstacle(other);
        if (!ok) {
            return;
        }
        const id = this._colliderId(other);
        if (!id) {
            return;
        }
        const isFront = this._wallSideIsFront(other);
        if (isFront) {
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
                `[PlayerPathSensors] PROBE BEGIN ${isFront ? 'FRONT' : 'BACK'} other="${other?.node?.name ?? '?'}"`,
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

    private _onProbeEnd(_self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) {
        const id = other?.isValid ? this._colliderId(other) : '';
        const ok = other?.isValid && this._isBlockingObstacle(other);
        let changed = false;
        if (id && this._frontWalls.delete(id)) {
            this._frontCount = Math.max(0, this._frontCount - 1);
            changed = true;
        } else if (id && this._backWalls.delete(id)) {
            this._backCount = Math.max(0, this._backCount - 1);
            changed = true;
        }
        if (this.debugLog && ok && changed) {
            console.log(
                `[PlayerPathSensors] PROBE END other="${other?.node?.name ?? '?'}"`,
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

    private _bind(sensor: Collider2D | null, isFront: boolean): void {
        if (!sensor?.isValid) {
            if (this.debugLog) {
                console.log(
                    '[PlayerPathSensors] bind skipped (missing sensor)',
                    isFront ? 'FRONT' : 'BACK',
                );
            }
            return;
        }

        let rb = sensor.getComponent(RigidBody2D);
        if (!rb) {
            rb = sensor.node.addComponent(RigidBody2D);
            rb.type = ERigidBody2DType.Kinematic;
            rb.fixedRotation = true;
        }
        rb.enabledContactListener = true;
        // Относительно статичных стен мир «несёт» голубя быстро влево/вправо — без CCD тонкий
        // передний бокс может проскочить за один шаг; тогда стоп срабатывает только от корпуса.
        rb.bullet = true;
        rb.fixedRotation = true;

        if (this.debugLog) {
            console.log(
                '[PlayerPathSensors] bind',
                isFront ? 'FRONT' : 'BACK',
                'sensorNode=',
                sensor.node?.name,
                'sensorFlag=',
                (sensor as any).sensor ?? (sensor as any)._sensor,
                'rbType=',
                (rb as any).type,
            );
        }
        sensor.on(
            Contact2DType.BEGIN_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onBegin(isFront, self, other, c),
            this,
        );
        sensor.on(
            Contact2DType.END_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onEnd(isFront, self, other, c),
            this,
        );
    }

    private _unbind(sensor: Collider2D | null): void {
        if (!sensor?.isValid) {
            return;
        }
        sensor.off(Contact2DType.BEGIN_CONTACT);
        sensor.off(Contact2DType.END_CONTACT);
    }

    private _colliderId(other: Collider2D): string {
        return (other as any).uuid ?? other.node?.uuid ?? '';
    }

    /**
     * Мировой AABB бокса: углы в локали → worldMatrix.
     * Важно для стен с поворотом (башня): старый вариант без rotation давал ложное «нет пересечения»
     * и prune снимал стоп, хотя физика и визуально сенсор ещё в контакте.
     */
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
        const sensor = this.useBodyColliderProbe
            ? this.bodyResolvedProbe ??
              this.bodyProbeCollider ??
              this.node.getComponent(BoxCollider2D)
            : isFront
              ? this.frontSensor
              : this.backSensor;
        const map = isFront ? this._frontWalls : this._backWalls;
        if (!sensor?.isValid || map.size === 0) {
            return;
        }
        const saRaw = this._boxWorldAabb(sensor);
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
                // Не BoxCollider2D — не гадаем по AABB, ждём только END_CONTACT.
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

    private _onBegin(
        isFront: boolean,
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        const ok = this._isBlockingObstacle(other);
        if (!ok) {
            return;
        }
        const id = this._colliderId(other);
        if (!id) {
            return;
        }
        if (isFront) {
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
            const g = (other as any).group ?? (other as any)._group;
            console.log(
                `[PlayerPathSensors] BEGIN ${isFront ? 'FRONT' : 'BACK'} other="${other?.node?.name ?? '?'}" group=${g}`,
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

    private _onEnd(
        isFront: boolean,
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        const id = other?.isValid ? this._colliderId(other) : '';
        const ok =
            other?.isValid && this._isBlockingObstacle(other);
        let changed = false;
        if (isFront) {
            if (id && this._frontWalls.delete(id)) {
                this._frontCount = Math.max(0, this._frontCount - 1);
                changed = true;
            } else if (!other?.isValid && this._frontCount > 0) {
                // Деградация: коллайдер уже уничтожен — prune подчистит по карте.
            }
        } else {
            if (id && this._backWalls.delete(id)) {
                this._backCount = Math.max(0, this._backCount - 1);
                changed = true;
            }
        }
        if (this.debugLog && ok && changed) {
            const g = other?.isValid
                ? (other as any).group ?? (other as any)._group
                : -1;
            console.log(
                `[PlayerPathSensors] END ${isFront ? 'FRONT' : 'BACK'} other="${other?.node?.name ?? '?'}" group=${g}`,
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
}
