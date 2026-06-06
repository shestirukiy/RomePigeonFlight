import {
    _decorator,
    Component,
    Node,
    Collider2D,
    BoxCollider2D,
    Contact2DType,
    IPhysics2DContact,
    RigidBody2D,
    ERigidBody2DType,
    Vec3,
} from 'cc';
import { GameManager } from './GameManager';
import { forEachPlayerAnimController } from './PlayerAnimationController';
import { PlayerController } from './PlayerController';
import { PickupBase } from './PickupBase';
import { MilestoneSign } from './MilestoneSign';
import { MilestoneDistanceLabel } from './MilestoneDistanceLabel';
import { TowerWallHazard } from './TowerWallHazard';
import { ElectricCloudHazard } from './ElectricCloudHazard';

const { ccclass, property, executionOrder } = _decorator;

/** Раньше LevelGenerator.update — после шага физики синхронизируем блокировки скролла. */
const PATH_SENSORS_EXEC_ORDER = -50;

/**
 * Контакты коллайдера игрока:
 * - **Sensor** на препятствии + маркер hazard (`TowerWallHazard` / `ElectricCloudHazard`) → урон, отдача;
 * - **не sensor**, группа препятствий → стоп камеры, бег по «полу» снизу.
 * Имена нод не важны — тип hazard только по компоненту на сенсоре или его родителях.
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
            'По X: внутри ±зоны — контакт считается «по центру» (лобовой для скролла). ' +
            'Для контакта «снизу» горизонтальная остановка скролла добавляется только если центр препятствия по X выходит за эту зону — тогда одновременно возможны бег по поверхности и стоп мира.',
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
    obstacleGroup = 1;

    @property({
        displayName: 'Surface run activation delay (s)',
        tooltip:
            'Непрерывный контакт «снизу» должен длиться не меньше этого времени, чтобы включить анимацию бега. ' +
            'Короткие касания игнорируются. 0 — без задержки.',
    })
    surfaceRunActivationDelaySec = 0.05;

    @property({
        displayName: 'Below — floor overlap min',
        tooltip:
            'Только для контакта «снизу»: доля ширины коллайдера игрока (по X), перекрытая платформой. ' +
            'Если больше порога — считаем длинную опору под ногами и не даём ложный стоп скролла «вперёд» из‑за смещённого центра платформы. 0 — отключить проверку.',
    })
    belowFloorSupportOverlapMin = 0.38;

    @property({
        displayName: 'Debug Log',
        tooltip: 'Контакты и счётчики блокировок.',
    })
    debugLog = true;

    private static readonly _PRUNE_AABB_EPS = 12;

    private _frontCount = 0;
    private _backCount = 0;
    private _belowCount = 0;

    private readonly _frontWalls = new Map<string, Collider2D>();
    private readonly _backWalls = new Map<string, Collider2D>();
    private readonly _belowWalls = new Map<string, Collider2D>();

    private _resolvedPathCollider: Collider2D | null = null;


    private _playerCtrl: PlayerController | null = null;

    private readonly _electricHazardCoolById = new Map<string, number>();
    private readonly _wallHazardCoolById = new Map<string, number>();

    /** Пока игрок в контакте с hazard-коллайдером (без повторного BEGIN). */
    private readonly _activeCloudContacts = new Map<string, Collider2D>();
    private readonly _activeWallContacts = new Map<string, Collider2D>();

    private _wasDamageInvincible = false;

    /** Накопление времени при непрерывном контакте снизу (для отложенного включения бега). */
    private _surfaceHoldAccumSec = 0;

    public get isFrontBlocked(): boolean {
        return this._frontCount > 0;
    }

    public get isBackBlocked(): boolean {
        return this._backCount > 0;
    }

    /** Есть опора под ногами (бег по земле/платформе), не боковая стена. */
    public get isOnSurfaceBelow(): boolean {
        return this._hasActiveSurfaceSupportBelow();
    }

    /** Новый забег после game over: контакты, кулдауны, блокировки скролла. */
    public resetForNewRun(): void {
        this._frontCount = 0;
        this._backCount = 0;
        this._belowCount = 0;
        this._surfaceHoldAccumSec = 0;
        this._wasDamageInvincible = false;
        this._frontWalls.clear();
        this._backWalls.clear();
        this._belowWalls.clear();
        this._activeCloudContacts.clear();
        this._activeWallContacts.clear();
        this._electricHazardCoolById.clear();
        this._wallHazardCoolById.clear();
        forEachPlayerAnimController(this.node, (a) =>
            a.setRunningOnSurface(false),
        );
        GameManager.game?.syncPathSensorBlockCounts(0, 0);
    }

    onLoad() {
        const probe =
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D) ??
            this.node.getComponent(Collider2D);
        this._resolvedPathCollider = probe;

        if (!this.getComponent(PlayerController)) {
            this.addComponent(PlayerController);
        }
        this._playerCtrl =
            this.getComponent(PlayerController) ??
            this.getComponentInChildren(PlayerController);

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
                this._activeCloudContacts.clear();
                this._activeWallContacts.clear();
                this._wasDamageInvincible = false;
                forEachPlayerAnimController(this.node, (a) =>
            a.setRunningOnSurface(false),
        );
            }
            return;
        }

        const inv = gm.isDamageInvincible;
        this._pruneStaleWalls(true);
        this._pruneStaleWalls(false);
        this._pruneStaleBelow();
        this._pruneFrontFloorSupportBlocks();
        this._pruneFrontCornerJams();
        this._pruneStaleActiveHazardContacts();
        this._resyncForwardBlocksFromOverlap();
        if (inv) {
            this._resyncForwardWallScrollBlocks();
        }
        gm.syncPathSensorBlockCounts(this._frontCount, this._backCount);

        this._tickHazardCooldowns(_dt);
        if (this._wasDamageInvincible && !inv) {
            this._pruneStaleWalls(true);
            this._pruneStaleWalls(false);
            this._reconcileWallScrollBlocksAfterInvincibility();
            this._retickTouchingHazards();
        }
        this._wasDamageInvincible = inv;

        this._updateSurfaceRunAnimation(_dt);
    }

    /**
     * Скролл мира (и «камера») должны ждать: лобовая стена впереди или касание стены в i-frames.
     */
    public shouldHoldForwardScroll(): boolean {
        return this._hasActiveForwardScrollBlock();
    }

    /** Лобовой блок скролла: счётчик или реальное перекрытие AABB (без урона / не TowerWall). */
    private _hasActiveForwardScrollBlock(): boolean {
        if (this._frontCount > 0) {
            return true;
        }
        for (const col of this._frontWalls.values()) {
            if (col?.isValid && this._hasAabbOverlapWithPlayer(col)) {
                return true;
            }
        }
        return false;
    }

    private _tickHazardCooldowns(dt: number): void {
        PlayerPathSensors._tickCooldownMap(this._electricHazardCoolById, dt);
        PlayerPathSensors._tickCooldownMap(this._wallHazardCoolById, dt);
    }

    private static _tickCooldownMap(map: Map<string, number>, dt: number): void {
        for (const [id, remain] of map) {
            const next = remain - dt;
            if (next <= 0) {
                map.delete(id);
            } else {
                map.set(id, next);
            }
        }
    }

    /** Бег только при опоре под ногами (не при касании вертикальной стены). */
    private _updateSurfaceRunAnimation(dt: number): void {
        const hasBelow = this._hasActiveSurfaceSupportBelow();
        if (!hasBelow) {
            this._surfaceHoldAccumSec = 0;
            forEachPlayerAnimController(this.node, (a) =>
                a.setRunningOnSurface(false),
            );
            return;
        }
        forEachPlayerAnimController(this.node, (a) => a.setFeetOnSurface(true));
        const minSec = this.surfaceRunActivationDelaySec;
        if (minSec <= 0) {
            forEachPlayerAnimController(this.node, (a) =>
                a.setRunningOnSurface(true),
            );
            return;
        }
        this._surfaceHoldAccumSec += dt;
        if (this._surfaceHoldAccumSec >= minSec) {
            forEachPlayerAnimController(this.node, (a) =>
                a.setRunningOnSurface(true),
            );
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

    /** Стена правее игрока по X → «вперёд» (скролл стоп). */
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

    /**
     * Доля ширины игрока по X, перекрытая другим боксом (мировые AABB).
     * −1 если посчитать нельзя (не BoxCollider2D и т.п.).
     */
    private _playerOverlapFractionX(other: Collider2D): number {
        const probe =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const pa = probe ? this._boxWorldAabb(probe) : null;
        const oa = this._boxWorldAabb(other);
        if (!pa || !oa) {
            return -1;
        }
        const overlap = Math.min(pa.xMax, oa.xMax) - Math.max(pa.xMin, oa.xMin);
        const pw = pa.xMax - pa.xMin;
        if (pw <= 1e-6) {
            return -1;
        }
        return Math.max(0, overlap) / pw;
    }

    /**
     * Стоп скролла (GameManager) не зависит от задержки анимации бега — счётчики front/back ведутся здесь же.
     * «Сбоку» — всегда. «Снизу» — узкая опора / торец; длинная платформа под ногами не режет скролл из‑за центра справа.
     */
    private _shouldApplyHorizontalScrollBlock(
        v: 'above' | 'below' | 'side',
        other: Collider2D,
    ): boolean {
        if (v === 'above') {
            return false;
        }
        if (v === 'side') {
            return true;
        }
        /* Длинная платформа под ногами — только бег, камера не стопится. */
        if (this._isWideFloorSupport(other)) {
            return false;
        }
        const px = this.node.worldPosition.x;
        const wx = other.node.worldPosition.x;
        return Math.abs(wx - px) > this.pathSideDeadZonePx;
    }

    /**
     * Опора под ногами: верх AABB препятствия у «ступней» игрока, есть перекрытие по X.
     * Вертикальная стена (верх коллайдера выше ног) сюда не попадает.
     */
    private _hasActiveSurfaceSupportBelow(): boolean {
        for (const col of this._belowWalls.values()) {
            if (col?.isValid && this._isSurfaceSupportFromBelow(col)) {
                return true;
            }
        }
        return false;
    }

    private _isSurfaceSupportFromBelow(other: Collider2D): boolean {
        const probe =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const pa = probe ? this._boxWorldAabb(probe) : null;
        const oa = this._boxWorldAabb(other);
        if (!pa || !oa) {
            return false;
        }
        const feetY = pa.yMin;
        const supportTopY = oa.yMax;
        const tol = this.pathVerticalDeadZonePx;
        if (supportTopY > feetY + tol || supportTopY < feetY - tol * 2) {
            return false;
        }
        const overlapX =
            Math.min(pa.xMax, oa.xMax) - Math.max(pa.xMin, oa.xMin);
        return overlapX > 0;
    }

    /** Широкий пол под ногами — бег без стопа камеры. */
    private _isWideFloorSupport(other: Collider2D): boolean {
        if (!this._isSurfaceSupportFromBelow(other)) {
            return false;
        }
        const minOv = this.belowFloorSupportOverlapMin;
        if (minOv <= 0) {
            return false;
        }
        const frac = this._playerOverlapFractionX(other);
        return frac >= minOv;
    }

    /** Общий корень препятствия — для угловых коллайдеров (по hazard-маркеру, не по имени). */
    private _obstacleRootKey(other: Collider2D): string {
        const root = this._findObstacleRootNode(other);
        if (root) {
            return `root:${root.uuid}`;
        }
        let n: Node | null = other.node;
        while (n && n !== this.node) {
            if (n.name === 'Ground') {
                return `root:${n.uuid}`;
            }
            n = n.parent;
        }
        return `col:${this._colliderId(other)}`;
    }

    /** Узел-префаб башни/облака: на нём или в детях есть hazard-маркер. */
    private _findObstacleRootNode(other: Collider2D): Node | null {
        let n: Node | null = other?.node ?? null;
        let lastWithHazard: Node | null = null;
        while (n && n !== this.node) {
            if (this._nodeHasHazardMarker(n)) {
                lastWithHazard = n;
            }
            n = n.parent;
        }
        return lastWithHazard;
    }

    private _nodeHasHazardMarker(n: Node): boolean {
        return !!(
            n.getComponent(TowerWallHazard) ||
            n.getComponent(ElectricCloudHazard) ||
            n.getComponentInChildren(TowerWallHazard) ||
            n.getComponentInChildren(ElectricCloudHazard)
        );
    }

    /**
     * Угол: ноги на опоре того же препятствия — не держим лобовой стоп камеры
     * (иначе «пол снизу + стена впереди» = застревание).
     */
    private _isForwardBlockSuppressedBySurfaceSupport(other: Collider2D): boolean {
        if (this._isSurfaceSupportFromBelow(other)) {
            return true;
        }
        const root = this._obstacleRootKey(other);
        for (const col of this._belowWalls.values()) {
            if (!col?.isValid) {
                continue;
            }
            if (
                this._obstacleRootKey(col) === root &&
                this._isSurfaceSupportFromBelow(col)
            ) {
                return true;
            }
        }
        return false;
    }

    private _onBeginContact(
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        const gm = GameManager.game;
        if (!gm?.isPlaying || !other?.isValid) {
            return;
        }

        if (this._tryCollectPickup(other)) {
            return;
        }

        if (this._tryMilestoneSignPass(other)) {
            return;
        }

        if (this._isLethalGround(other)) {
            if (this.debugLog) {
                console.log(
                    `[PlayerPathSensors] lethal Ground other="${other.node?.name ?? '?'}"`,
                );
            }
            gm.tryInstantKillOrHelmetSave();
            return;
        }

        if (this._isDamageSensor(other)) {
            const hazard = this._hazardKindByComponent(other);
            if (hazard === 'cloud') {
                const cloudId = this._colliderId(other);
                if (cloudId) {
                    this._activeCloudContacts.set(cloudId, other);
                }
                this._tryElectricCloudHit(other);
            } else if (hazard === 'wall') {
                const wallId = this._colliderId(other);
                if (wallId) {
                    this._activeWallContacts.set(wallId, other);
                }
                this._tryTowerWallHit(other);
            }
            return;
        }

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

        if (this._isSurfaceSupportFromBelow(other)) {
            if (!this._belowWalls.has(id)) {
                this._belowWalls.set(id, other);
                this._belowCount++;
                if (this.debugLog) {
                    console.log(
                        `[PlayerPathSensors] BEGIN SURFACE (feet) other="${other?.node?.name ?? '?'}" below=${this._belowCount}`,
                    );
                }
            }
        }

        if (
            !this._isWideFloorSupport(other) &&
            this._shouldApplyHorizontalScrollBlock(v, other)
        ) {
            let forward = this._wallBlocksForward(other);
            if (
                !forward &&
                gm.isDamageInvincible &&
                this._hasAabbOverlapWithPlayer(other)
            ) {
                forward = true;
            }
            if (
                forward &&
                this._isForwardBlockSuppressedBySurfaceSupport(other)
            ) {
                forward = false;
            }
            if (forward) {
                if (!this._frontWalls.has(id)) {
                    this._frontWalls.set(id, other);
                    this._frontCount++;
                }
            } else {
                if (!this._backWalls.has(id)) {
                    this._backWalls.set(id, other);
                    this._backCount++;
                }
            }
            if (this.debugLog) {
                console.log(
                    `[PlayerPathSensors] BEGIN ${forward ? 'FRONT' : 'BACK'} ` +
                        `(v=${v}) other="${other?.node?.name ?? '?'}"`,
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

    private _onEndContact(_self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) {
        const gm = GameManager.game;
        const id = other?.isValid ? this._colliderId(other) : '';
        const isSensor = other?.isValid && this._isDamageSensor(other);
        const hazard = isSensor ? this._hazardKindByComponent(other) : '';
        /* Скролл: во время i-frames не снимаем front/back у твёрдых коллайдеров. */
        const holdScrollWallMapsDuringInv =
            !!gm?.isDamageInvincible &&
            !isSensor &&
            !!other?.isValid &&
            this._isBlockingObstacle(other);

        if (id && other?.isValid && isSensor) {
            if (hazard === 'cloud') {
                this._activeCloudContacts.delete(id);
            } else if (hazard === 'wall') {
                this._activeWallContacts.delete(id);
            }
        }
        const ok = other?.isValid && this._isBlockingObstacle(other);
        let changed = false;
        /* Один коллайдер может быть и «впереди», и «снизу» — снимаем со всех карт, не else-if. */
        if (id && !holdScrollWallMapsDuringInv) {
            if (this._frontWalls.delete(id)) {
                this._frontCount = Math.max(0, this._frontCount - 1);
                changed = true;
            }
            if (this._backWalls.delete(id)) {
                this._backCount = Math.max(0, this._backCount - 1);
                changed = true;
            }
            if (this._belowWalls.delete(id)) {
                this._belowCount = Math.max(0, this._belowCount - 1);
                changed = true;
            }
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
        const gm = GameManager.game;
        if (isFront && gm?.isDamageInvincible) {
            return;
        }
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

    /** Пол под ногами не должен держать frontCount (баг: камера стоп при беге). */
    private _pruneFrontFloorSupportBlocks(): void {
        for (const [id, col] of this._frontWalls) {
            if (!col?.isValid) {
                continue;
            }
            if (this._isWideFloorSupport(col)) {
                this._frontWalls.delete(id);
            }
        }
        this._frontCount = this._frontWalls.size;
    }

    /** Угол препятствия: опора снизу + лобовой front на том же root. */
    private _pruneFrontCornerJams(): void {
        for (const [id, col] of this._frontWalls) {
            if (this._isForwardBlockSuppressedBySurfaceSupport(col)) {
                this._frontWalls.delete(id);
            }
        }
        this._frontCount = this._frontWalls.size;
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
            if (
                !this._aabbOverlap(sa, wa) ||
                !this._isSurfaceSupportFromBelow(wall)
            ) {
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

    private _tryCollectPickup(other: Collider2D): boolean {
        const pickup = PickupBase.resolve(other.node);
        if (!pickup || pickup.isCollected) {
            return false;
        }
        if (this.debugLog) {
            console.log(
                `[PlayerPathSensors] pickup collected other="${other.node?.name ?? '?'}"`,
            );
        }
        pickup.collect();
        return true;
    }

    /** ObstaclesContainer/Ground (не SkyGround). */
    private _isLethalGround(other: Collider2D): boolean {
        let n: Node | null = other.node;
        while (n) {
            if (n === this.node) {
                return false;
            }
            if (n.name === 'SkyGround' || n.name === 'SkySensor') {
                return false;
            }
            if (n.name === 'Ground') {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    private _tryMilestoneSignPass(other: Collider2D): boolean {
        const sign = this._findMilestoneSign(other);
        if (!sign) {
            return false;
        }
        if (this.debugLog) {
            console.log(
                `[PlayerPathSensors] milestone sign other="${other.node?.name ?? '?'}" m=${sign.milestoneMeters}`,
            );
        }
        return sign.tryPassFromPlayerContact();
    }

    private _findMilestoneSign(other: Collider2D): MilestoneSign | null {
        let n: Node | null = other.node;
        while (n) {
            const existing = n.getComponent(MilestoneSign);
            if (existing) {
                return existing;
            }
            if (
                n.name === 'MilestoneSign' ||
                n.getComponent(MilestoneDistanceLabel)
            ) {
                return MilestoneSign.ensureOn(n);
            }
            n = n.parent;
        }
        return null;
    }

    /** Sensor-коллайдер на препятствии — зона урона (тип опасности — по компонентам hazard). */
    private _isDamageSensor(other: Collider2D): boolean {
        const otherAny = other as any;
        return otherAny.sensor === true || otherAny._sensor === true;
    }

    private _hazardKindByComponent(other: Collider2D): 'cloud' | 'wall' | null {
        if (this._findHazardNode(other, 'wall')) {
            return 'wall';
        }
        if (this._findHazardNode(other, 'cloud')) {
            return 'cloud';
        }
        return null;
    }

    private _findHazardNode(
        other: Collider2D,
        kind: 'cloud' | 'wall',
    ): Node | null {
        let n: Node | null = other?.node ?? null;
        while (n) {
            if (n === this.node) {
                return null;
            }
            const hit =
                kind === 'wall'
                    ? this._findWallHazardOnNode(n)
                    : this._findCloudHazardOnNode(n);
            if (hit) {
                return hit;
            }
            n = n.parent;
        }
        return null;
    }

    /** Нода с маркером (на себе или у прямого потомка-сенсора). */
    private _findWallHazardOnNode(n: Node): Node | null {
        if (n.getComponent(TowerWallHazard)) {
            return n;
        }
        return null;
    }

    private _findCloudHazardOnNode(n: Node): Node | null {
        if (n.getComponent(ElectricCloudHazard)) {
            return n;
        }
        return null;
    }

    private _retickTouchingHazards(): void {
        const cloudRoots = new Set<string>();
        for (const col of this._activeCloudContacts.values()) {
            if (!col?.isValid || !this._hasAabbOverlapWithPlayer(col)) {
                continue;
            }
            const rootKey = this._hazardRootKey(col, 'cloud');
            if (cloudRoots.has(rootKey)) {
                continue;
            }
            cloudRoots.add(rootKey);
            this._tryElectricCloudHit(col);
        }

        const wallRoots = new Set<string>();
        for (const col of this._activeWallContacts.values()) {
            if (!col?.isValid || !this._hasAabbOverlapWithPlayer(col)) {
                continue;
            }
            const rootKey = this._hazardRootKey(col, 'wall');
            if (wallRoots.has(rootKey)) {
                continue;
            }
            wallRoots.add(rootKey);
            this._tryTowerWallHit(col);
        }
    }

    /** Урон только при реальном перекрытии; END во время i-frames мог не прийти. */
    private _pruneStaleActiveHazardContacts(): void {
        for (const [id, col] of this._activeWallContacts) {
            if (!col?.isValid || !this._hasAabbOverlapWithPlayer(col)) {
                this._activeWallContacts.delete(id);
            }
        }
        for (const [id, col] of this._activeCloudContacts) {
            if (!col?.isValid || !this._hasAabbOverlapWithPlayer(col)) {
                this._activeCloudContacts.delete(id);
            }
        }
    }

    private _hazardRootKey(other: Collider2D, kind: 'cloud' | 'wall'): string {
        const obstacleRoot = this._findObstacleRootNode(other);
        if (obstacleRoot) {
            return `${kind}:${obstacleRoot.uuid}`;
        }
        const hazardNode = this._findHazardNode(other, kind);
        if (hazardNode) {
            return `${kind}:${hazardNode.uuid}`;
        }
        return `${kind}:${this._colliderId(other)}`;
    }

    private _tryElectricCloudHit(other: Collider2D): void {
        const gm = GameManager.game;
        const pc = this._playerCtrl;
        const id = this._colliderId(other);
        if (!gm?.isPlaying || !pc || !id) {
            return;
        }
        if (!this._hasAabbOverlapWithPlayer(other)) {
            return;
        }
        if (gm.isDamageInvincible) {
            return;
        }
        const rootKey = this._hazardRootKey(other, 'cloud');
        if ((this._electricHazardCoolById.get(rootKey) ?? 0) > 0) {
            return;
        }
        if (this.debugLog) {
            console.log(
                `[PlayerPathSensors] electric hit other="${other.node?.name ?? '?'}"`,
            );
        }
        pc.applyElectricCloudHit();
        const cd = Math.max(
            pc.damageInvincibilitySec,
            pc.electricCloudCooldownSeconds,
            pc.electricDefaultLiftLockDuration,
        );
        this._electricHazardCoolById.set(rootKey, cd);
    }

    private _tryTowerWallHit(other: Collider2D): void {
        const gm = GameManager.game;
        const pc = this._playerCtrl;
        const id = this._colliderId(other);
        if (!gm?.isPlaying || !pc || !id) {
            return;
        }
        if (!this._hasAabbOverlapWithPlayer(other)) {
            return;
        }
        if (gm.isDamageInvincible) {
            return;
        }
        if (gm.isWorldKickbackActive) {
            gm.cancelWorldKickback();
        }
        const rootKey = this._hazardRootKey(other, 'wall');
        if ((this._wallHazardCoolById.get(rootKey) ?? 0) > 0) {
            return;
        }
        if (this.debugLog) {
            console.log(
                `[PlayerPathSensors] wall hit other="${other.node?.name ?? '?'}"`,
            );
        }
        pc.applyTowerWallHit();
        const cd = Math.max(
            pc.damageInvincibilitySec,
            pc.towerWallCooldownSeconds,
            pc.towerWallKnockbackDurationSec,
        );
        this._wallHazardCoolById.set(rootKey, cd);
    }

    /**
     * Контакт мог попасть в below/back или prune сбросил front, хотя AABB ещё перекрывается.
     * Восстанавливаем лобовой блок для любого препятствия (не только TowerWall с уроном).
     */
    private _resyncForwardBlocksFromOverlap(): void {
        const sources = [
            ...this._frontWalls.values(),
            ...this._backWalls.values(),
            ...this._belowWalls.values(),
        ];
        const seen = new Set<string>();
        for (const col of sources) {
            if (!col?.isValid || !this._isBlockingObstacle(col)) {
                continue;
            }
            if (!this._hasAabbOverlapWithPlayer(col)) {
                continue;
            }
            const v = this._verticalBand(col);
            if (
                v === 'above' ||
                this._isWideFloorSupport(col) ||
                this._isForwardBlockSuppressedBySurfaceSupport(col) ||
                !this._shouldApplyHorizontalScrollBlock(v, col) ||
                !this._wallBlocksForward(col)
            ) {
                continue;
            }
            const id = this._colliderId(col);
            if (!id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            if (!this._frontWalls.has(id)) {
                this._frontWalls.set(id, col);
                this._frontCount++;
            }
        }
        this._frontCount = this._frontWalls.size;
    }

    /** После отдачи мир сдвигается — prune мог сбросить front; в i-frames восстанавливаем блок. */
    private _resyncForwardWallScrollBlocks(): void {
        for (const col of this._activeWallContacts.values()) {
            if (!col?.isValid) {
                continue;
            }
            const v = this._verticalBand(col);
            if (
                v === 'above' ||
                !this._shouldApplyHorizontalScrollBlock(v, col)
            ) {
                continue;
            }
            if (
                !this._wallBlocksForward(col) &&
                !this._hasAabbOverlapWithPlayer(col)
            ) {
                continue;
            }
            const id = this._colliderId(col);
            if (!id || this._frontWalls.has(id)) {
                continue;
            }
            if (!this._hasAabbOverlapWithPlayer(col)) {
                continue;
            }
            this._frontWalls.set(id, col);
            this._frontCount++;
        }
    }

    /** Сброс ложных END во время i-frames: пересчёт front/back по фактическому перекрытию. */
    private _reconcileWallScrollBlocksAfterInvincibility(): void {
        const seenFront = new Set<string>();
        const seenBack = new Set<string>();
        const sources = [
            ...this._activeWallContacts.values(),
            ...this._frontWalls.values(),
            ...this._backWalls.values(),
        ];
        for (const col of sources) {
            if (!col?.isValid || !this._hasAabbOverlapWithPlayer(col)) {
                continue;
            }
            const v = this._verticalBand(col);
            if (
                v === 'above' ||
                !this._shouldApplyHorizontalScrollBlock(v, col)
            ) {
                continue;
            }
            const id = this._colliderId(col);
            if (!id) {
                continue;
            }
            if (this._wallBlocksForward(col)) {
                seenFront.add(id);
            } else {
                seenBack.add(id);
            }
        }
        this._frontWalls.clear();
        this._backWalls.clear();
        this._frontCount = 0;
        this._backCount = 0;
        for (const col of sources) {
            if (!col?.isValid) {
                continue;
            }
            const id = this._colliderId(col);
            if (!id) {
                continue;
            }
            if (seenFront.has(id)) {
                this._frontWalls.set(id, col);
            } else if (seenBack.has(id)) {
                this._backWalls.set(id, col);
            }
        }
        this._frontCount = this._frontWalls.size;
        this._backCount = this._backWalls.size;
        for (const id of seenFront) {
            const col = this._frontWalls.get(id);
            if (col?.isValid) {
                this._activeWallContacts.set(id, col);
            }
        }
    }

    private _hasAabbOverlapWithPlayer(other: Collider2D): boolean {
        const probe =
            this._resolvedPathCollider ??
            this.pathCollider ??
            this.node.getComponent(BoxCollider2D);
        const saRaw = probe ? this._boxWorldAabb(probe) : null;
        const wa = this._boxWorldAabb(other);
        if (!saRaw || !wa) {
            return false;
        }
        const eps = PlayerPathSensors._PRUNE_AABB_EPS;
        const sa = {
            xMin: saRaw.xMin - eps,
            xMax: saRaw.xMax + eps,
            yMin: saRaw.yMin - eps,
            yMax: saRaw.yMax + eps,
        };
        return this._aabbOverlap(sa, wa);
    }

    /** Твёрдый коллайдер препятствия: стоп камеры / бег, без урона. */
    private _isBlockingObstacle(other: Collider2D): boolean {
        if (!other?.isValid || this._isDamageSensor(other)) {
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
