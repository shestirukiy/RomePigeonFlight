import {
    _decorator,
    Animation,
    AnimationClip,
    BoxCollider2D,
    CircleCollider2D,
    Collider2D,
    Component,
    Contact2DType,
    instantiate,
    IPhysics2DContact,
    Node,
    PhysicsSystem2D,
    Rect,
    RigidBody2D,
    Vec3,
} from 'cc';
import { BonusItemScheduler } from './BonusItemScheduler';
import { GameManager } from './GameManager';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';
import { MagnetPickable } from './MagnetPickable';
import { ElectricCloudHazard } from './ElectricCloudHazard';
import { MilestoneDistanceLabel } from './MilestoneDistanceLabel';
import { MilestoneSign } from './MilestoneSign';
import { PickupBase } from './PickupBase';
import { TowerWallHazard } from './TowerWallHazard';

const { ccclass, property } = _decorator;

type BuffPhase = 'idle' | 'appear' | 'loop' | 'disappear';

const G_REFS = { id: 'Refs', name: 'References' };
const G_MAGNET_CIRCLE = { id: 'MagnetCircle', name: 'Magnet Circle' };
const G_TUNE = { id: 'Tune', name: 'Tuning' };

/**
 * Equipped Magnet / Wisdom на Player: appear → loop → disappear, коллайдеры на время buff.
 */
@ccclass('PlayerEquippedBuffs')
export class PlayerEquippedBuffs extends Component {
    private static readonly MAGNET_NODE = 'Magnet';
    private static readonly MAGNET_CIRCLE_CENTER = 'MagnetCircleCenter';
    private static readonly WISDOM_NODE = 'Wisdom';
    private static readonly MAGNET_COLLIDER_NODE = 'MagnetCollider';
    private static readonly WISDOM_COLLIDER_NODE = 'WisdomCollider';
    private static readonly WISDOM_APPEAR_CLIP = 'WisdomAppear';
    private static readonly WISDOM_LOOP_CLIP = 'WisdomIdle';
    private static readonly WISDOM_DISAPPEAR_CLIP = 'WisdomDissaappear';
    private static readonly PLAYER_CONTAINER = 'PlayerContainer';

    @property({ group: G_REFS, type: Node, displayName: 'Magnet Root' })
    magnetRoot: Node | null = null;

    @property({ group: G_REFS, type: Node, displayName: 'Magnet Circle Center' })
    magnetCircleCenter: Node | null = null;

    @property({ group: G_REFS, type: Collider2D, displayName: 'Magnet Collider' })
    magnetCollider: Collider2D | null = null;

    @property({ group: G_REFS, type: Node, displayName: 'Wisdom Root' })
    wisdomRoot: Node | null = null;

    @property({ group: G_REFS, type: Collider2D, displayName: 'Wisdom Collider' })
    wisdomCollider: Collider2D | null = null;

    @property({ group: G_MAGNET_CIRCLE, type: AnimationClip, displayName: 'Appear Clip' })
    magnetCircleAppearClip: AnimationClip | null = null;

    @property({ group: G_MAGNET_CIRCLE, type: AnimationClip, displayName: 'Loop Clip' })
    magnetCircleLoopClip: AnimationClip | null = null;

    @property({ group: G_MAGNET_CIRCLE, type: AnimationClip, displayName: 'Disappear Clip' })
    magnetCircleDisappearClip: AnimationClip | null = null;

    @property({ group: G_TUNE, displayName: 'Obstacle Group', tooltip: 'Как у PlayerPathSensors.' })
    obstacleGroup = 1;

    private _magnetAnim: Animation | null = null;
    private _magnetCircleAnim: Animation | null = null;
    private _wisdomAnim: Animation | null = null;
    private _magnetCircleDisappearDone: (() => void) | null = null;

    private _magnetPhase: BuffPhase = 'idle';
    private _wisdomPhase: BuffPhase = 'idle';
    private _magnetLoopRemain = 0;
    private _wisdomLoopRemain = 0;

    private _wisdomObstacleHits = 0;
    private _wisdomContactsBound = false;
    private _wisdomDisappearFxNode: Node | null = null;
    private _wisdomDisappearFxPlaying = false;
    private _wisdomDisappearFxDone: (() => void) | null = null;

    onLoad(): void {
        this._resolveRefs();
        this._hideMagnetCircleImmediate();
        this._hideBuffRoots();
    }

    /** Пустые слоты в инспекторе — fallback по имени дочерних нод Player. */
    private _resolveRefs(): void {
        if (!this.magnetRoot?.isValid) {
            this.magnetRoot = this.node.getChildByName(PlayerEquippedBuffs.MAGNET_NODE);
        }
        if (!this.magnetCircleCenter?.isValid) {
            this.magnetCircleCenter = this.node.getChildByName(
                PlayerEquippedBuffs.MAGNET_CIRCLE_CENTER,
            );
        }
        if (!this.wisdomRoot?.isValid) {
            this.wisdomRoot = this.node.getChildByName(PlayerEquippedBuffs.WISDOM_NODE);
        }
        if (!this.magnetCollider?.isValid) {
            this.magnetCollider = this._resolveCollider(
                this.magnetCircleCenter ?? this.magnetRoot,
                PlayerEquippedBuffs.MAGNET_COLLIDER_NODE,
            );
        }
        if (!this.wisdomCollider?.isValid) {
            this.wisdomCollider = this._resolveCollider(
                this.wisdomRoot,
                PlayerEquippedBuffs.WISDOM_COLLIDER_NODE,
            );
        }
        this._magnetAnim = this.magnetRoot?.getComponent(Animation) ?? null;
        this._magnetCircleAnim = this.magnetCircleCenter?.getComponent(Animation) ?? null;
        this._wisdomAnim = this.wisdomRoot?.getComponent(Animation) ?? null;
    }

    onDestroy(): void {
        this._clearMagnetCircleAnimCallbacks();
        this._cancelWisdomDisappearFx();
        this._unbindWisdomContacts();
        MagnetPickable.clearEquippedMagnetZone();
        GameManager.game?.setWisdomBuffActive(false);
    }

    update(dt: number): void {
        this._tickMagnet(dt);
        this._tickWisdom(dt);
    }

    public resetForNewRun(): void {
        this._cancelMagnet();
        this._cancelWisdom();
        this._hideBuffRoots();
    }

    public activateMagnet(): void {
        if (!this.isPlaying()) {
            return;
        }
        this._cancelMagnet();
        const cfg = BonusItemScheduler.instance;
        const duration = Math.max(0.05, cfg?.magnetBuffDurationSec ?? 6);
        if (!this.magnetRoot?.isValid) {
            return;
        }
        this.magnetRoot.active = true;
        SoundController.instance?.play(SoundId.MagnetActivate);
        this._setColliderEnabled(this.magnetCollider, false);
        this._showMagnetCircle();
        this._magnetLoopRemain = duration;
        this._beginBuffSequence(
            this._magnetAnim,
            cfg?.magnetAppearClip ?? null,
            cfg?.magnetLoopClip ?? null,
            cfg?.magnetDisappearClip ?? null,
            'magnet',
            () => this._setColliderEnabled(this.magnetCollider, true),
            () => this._setColliderEnabled(this.magnetCollider, false),
        );
    }

    public activateWisdom(): void {
        if (!this.isPlaying()) {
            return;
        }
        this._cancelWisdom();
        const cfg = BonusItemScheduler.instance;
        const duration = Math.max(0.05, cfg?.wisdomBuffDurationSec ?? 8);
        if (!this.wisdomRoot?.isValid) {
            return;
        }
        GameManager.game?.setWisdomBuffActive(true);
        this.wisdomRoot.active = true;
        SoundController.instance?.play(SoundId.WisdomActivate);
        this._wisdomObstacleHits = 0;
        GameManager.game?.notifyWisdomObstacleAhead(false);
        this._setColliderEnabled(this.wisdomCollider, false);
        this._bindWisdomContacts();
        this._wisdomLoopRemain = duration;
        this._beginBuffSequence(
            this._wisdomAnim,
            this._resolveWisdomClip(cfg?.wisdomAppearClip, PlayerEquippedBuffs.WISDOM_APPEAR_CLIP),
            this._resolveWisdomClip(cfg?.wisdomLoopClip, PlayerEquippedBuffs.WISDOM_LOOP_CLIP),
            this._resolveWisdomClip(cfg?.wisdomDisappearClip, PlayerEquippedBuffs.WISDOM_DISAPPEAR_CLIP),
            'wisdom',
            () => this._setColliderEnabled(this.wisdomCollider, true),
            () => {
                this._setColliderEnabled(this.wisdomCollider, false);
                this._unbindWisdomContacts();
                GameManager.game?.setWisdomBuffActive(false);
            },
        );
    }

    private _tickMagnet(dt: number): void {
        if (this._magnetPhase !== 'loop' || !this.isPlaying()) {
            MagnetPickable.clearEquippedMagnetZone();
            return;
        }
        this._magnetLoopRemain = Math.max(0, this._magnetLoopRemain - dt);
        const col = this.magnetCollider;
        if (col?.isValid && col.enabled) {
            const radius =
                col instanceof CircleCollider2D
                    ? Math.max(8, col.radius)
                    : 280;
            MagnetPickable.setEquippedMagnetZone(
                this.magnetCollider?.node ?? this.magnetCircleCenter ?? this.magnetRoot,
                radius,
            );
        }
        if (this._magnetLoopRemain <= 0) {
            this._finishMagnetLoop();
        }
    }

    private _tickWisdom(dt: number): void {
        if (this._wisdomPhase !== 'loop' || !this.isPlaying()) {
            return;
        }
        this._wisdomLoopRemain = Math.max(0, this._wisdomLoopRemain - dt);
        this._probeWisdomObstacleOverlap();
        if (this._wisdomLoopRemain <= 0) {
            this._finishWisdomLoop();
        }
    }

    private _finishMagnetLoop(): void {
        const cfg = BonusItemScheduler.instance;
        SoundController.instance?.play(SoundId.MagnetDeactivate);
        MagnetPickable.clearEquippedMagnetZone();
        this._setColliderEnabled(this.magnetCollider, false);
        this._playMagnetCircleDisappear();
        this._playDisappear(
            this._magnetAnim,
            cfg?.magnetDisappearClip ?? null,
            'magnet',
            () => this._hideMagnet(),
        );
    }

    private _finishWisdomLoop(): void {
        SoundController.instance?.play(SoundId.WisdomDeactivate);
        this._setColliderEnabled(this.wisdomCollider, false);
        this._unbindWisdomContacts();
        GameManager.game?.notifyWisdomObstacleAhead(false);
        this._playWisdomDisappear(() => {
            GameManager.game?.setWisdomBuffActive(false);
            this._hideWisdom();
        });
    }

    private _cancelMagnet(): void {
        this._magnetPhase = 'idle';
        this._magnetLoopRemain = 0;
        MagnetPickable.clearEquippedMagnetZone();
        this._setColliderEnabled(this.magnetCollider, false);
        this._hideMagnetCircleImmediate();
        this._magnetAnim?.stop();
    }

    private _cancelWisdom(): void {
        this._wisdomPhase = 'idle';
        this._wisdomLoopRemain = 0;
        this._wisdomObstacleHits = 0;
        this._cancelWisdomDisappearFx();
        this._unbindWisdomContacts();
        GameManager.game?.setWisdomBuffActive(false);
        GameManager.game?.notifyWisdomObstacleAhead(false);
        this._setColliderEnabled(this.wisdomCollider, false);
        this._wisdomAnim?.stop();
    }

    private _beginBuffSequence(
        anim: Animation | null,
        appear: AnimationClip | null,
        loop: AnimationClip | null,
        _disappear: AnimationClip | null,
        kind: 'magnet' | 'wisdom',
        onLoopStart: () => void,
        _onEnd: () => void,
    ): void {
        const enterLoop = (): void => {
            onLoopStart();
            if (kind === 'magnet') {
                this._magnetPhase = 'loop';
            } else {
                this._wisdomPhase = 'loop';
            }
            if (loop?.name && anim) {
                this._ensureClip(anim, loop);
                const st = anim.getState(loop.name);
                if (st) {
                    st.wrapMode = AnimationClip.WrapMode.Loop;
                }
                anim.play(loop.name);
            }
        };

        if (kind === 'magnet') {
            this._magnetPhase = 'appear';
        } else {
            this._wisdomPhase = 'appear';
        }

        if (appear?.name && anim) {
            this._ensureClip(anim, appear);
            anim.once(Animation.EventType.FINISHED, enterLoop, this);
            anim.play(appear.name);
            return;
        }

        enterLoop();
    }

    private _playWisdomDisappear(onDone: () => void): void {
        this._wisdomPhase = 'disappear';
        const cfg = BonusItemScheduler.instance;
        const clip = this._resolveWisdomClip(
            cfg?.wisdomDisappearClip,
            PlayerEquippedBuffs.WISDOM_DISAPPEAR_CLIP,
        );
        const wisdom = this.wisdomRoot;
        if (!clip?.name || !wisdom?.isValid) {
            onDone();
            return;
        }

        this._wisdomAnim?.stop();
        wisdom.active = false;

        const fx = this._spawnDetachedWisdomDisappearFx(wisdom);
        if (!fx?.isValid) {
            onDone();
            return;
        }

        const anim = fx.getComponent(Animation) ?? fx.getComponentInChildren(Animation);
        if (!anim) {
            fx.destroy();
            onDone();
            return;
        }

        this._ensureClip(anim, clip);
        this._wisdomDisappearFxNode = fx;
        this._wisdomDisappearFxPlaying = true;
        this._wisdomDisappearFxDone = onDone;

        anim.on(
            Animation.EventType.FINISHED,
            this._onWisdomDisappearFxAnimFinished,
            this,
        );
        anim.play(clip.name);

        let duration = 0.9;
        const st = anim.getState(clip.name);
        if (st && st.duration > 0) {
            duration = Math.max(
                0.05,
                st.duration / Math.max(Math.abs(st.speed), 1e-5),
            );
        } else if (clip.duration > 0) {
            duration = Math.max(0.05, clip.duration);
        }
        this.unschedule(this._onWisdomDisappearFxTimedFinish);
        this.scheduleOnce(this._onWisdomDisappearFxTimedFinish, duration + 0.05);
    }

    private _onWisdomDisappearFxAnimFinished = (
        _type?: string,
        st?: { name?: string },
    ): void => {
        if (!this._wisdomDisappearFxPlaying) {
            return;
        }
        const clipName = this._resolveWisdomClip(
            BonusItemScheduler.instance?.wisdomDisappearClip,
            PlayerEquippedBuffs.WISDOM_DISAPPEAR_CLIP,
        )?.name;
        if (st?.name && clipName && st.name !== clipName) {
            return;
        }
        this._finishWisdomDisappearFx();
    };

    private _onWisdomDisappearFxTimedFinish = (): void => {
        this._finishWisdomDisappearFx();
    };

    private _finishWisdomDisappearFx(): void {
        if (!this._wisdomDisappearFxPlaying) {
            return;
        }
        this._wisdomDisappearFxPlaying = false;
        this.unschedule(this._onWisdomDisappearFxTimedFinish);
        const fx = this._wisdomDisappearFxNode;
        if (fx?.isValid) {
            const anim = fx.getComponent(Animation) ?? fx.getComponentInChildren(Animation);
            anim?.off(
                Animation.EventType.FINISHED,
                this._onWisdomDisappearFxAnimFinished,
                this,
            );
            anim?.stop();
            fx.destroy();
        }
        this._wisdomDisappearFxNode = null;
        const done = this._wisdomDisappearFxDone;
        this._wisdomDisappearFxDone = null;
        done?.();
    }

    /** Сброс/Play Again: уничтожить FX без onDone. */
    private _cancelWisdomDisappearFx(): void {
        if (!this._wisdomDisappearFxPlaying && !this._wisdomDisappearFxNode) {
            this._wisdomDisappearFxDone = null;
            return;
        }
        this._wisdomDisappearFxPlaying = false;
        this._wisdomDisappearFxDone = null;
        this.unschedule(this._onWisdomDisappearFxTimedFinish);
        const fx = this._wisdomDisappearFxNode;
        if (fx?.isValid) {
            const anim = fx.getComponent(Animation) ?? fx.getComponentInChildren(Animation);
            anim?.off(
                Animation.EventType.FINISHED,
                this._onWisdomDisappearFxAnimFinished,
                this,
            );
            anim?.stop();
            fx.destroy();
        }
        this._wisdomDisappearFxNode = null;
    }

    /** Клон/prefab disappear-FX в PlayerContainer (якорь = Wisdom world pose). */
    private _spawnDetachedWisdomDisappearFx(wisdom: Node): Node | null {
        const container = this._resolvePlayerContainer();
        if (!container?.isValid) {
            return null;
        }

        this._updateWorldTransformChain(wisdom);

        const anchor = new Node('WisdomDisappearFxHost');
        anchor.active = true;
        anchor.layer = wisdom.layer;
        anchor.setParent(container, false);

        const host = wisdom.parent;
        if (host?.isValid) {
            anchor.setWorldPosition(host.worldPosition);
            anchor.setWorldRotation(host.worldRotation);
            anchor.setWorldScale(host.worldScale);
        } else {
            anchor.setWorldPosition(wisdom.worldPosition);
            anchor.setWorldRotation(wisdom.worldRotation);
            anchor.setWorldScale(wisdom.worldScale);
        }

        const cfg = BonusItemScheduler.instance;
        const prefab = cfg?.wisdomDisappearFxPrefab ?? null;
        const fx = prefab ? instantiate(prefab) : instantiate(wisdom);
        if (!fx?.isValid) {
            anchor.destroy();
            return null;
        }

        fx.active = true;
        fx.layer = wisdom.layer;
        fx.setParent(anchor, false);
        fx.setPosition(wisdom.position);
        fx.setRotation(wisdom.rotation);
        fx.setScale(wisdom.scale);
        this._disableFxColliders(fx);

        const anim = fx.getComponent(Animation);
        if (anim) {
            anim.enabled = true;
        }

        return anchor;
    }

    private _resolvePlayerContainer(): Node | null {
        const parent = this.node.parent;
        if (parent?.isValid && parent.name === PlayerEquippedBuffs.PLAYER_CONTAINER) {
            return parent;
        }
        if (parent?.isValid) {
            return parent;
        }
        return null;
    }

    private _updateWorldTransformChain(node: Node): void {
        const chain: Node[] = [];
        let cur: Node | null = node;
        while (cur?.isValid) {
            chain.push(cur);
            cur = cur.parent;
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            chain[i].updateWorldTransform();
        }
    }

    private _resolveWisdomClip(
        fromScheduler: AnimationClip | null | undefined,
        fallbackName: string,
    ): AnimationClip | null {
        if (fromScheduler?.name) {
            return fromScheduler;
        }
        return this._findAnimClip(this._wisdomAnim, fallbackName);
    }

    private _findAnimClip(anim: Animation | null, clipName: string): AnimationClip | null {
        if (!anim?.isValid) {
            return null;
        }
        for (const clip of anim.clips) {
            if (clip?.name === clipName) {
                return clip;
            }
        }
        return null;
    }

    private _disableFxColliders(root: Node): void {
        for (const col of root.getComponentsInChildren(Collider2D)) {
            col.enabled = false;
        }
    }

    private _playDisappear(
        anim: Animation | null,
        clip: AnimationClip | null,
        kind: 'magnet' | 'wisdom',
        onDone: () => void,
    ): void {
        if (kind === 'magnet') {
            this._magnetPhase = 'disappear';
        } else {
            this._wisdomPhase = 'disappear';
        }

        if (clip?.name && anim) {
            this._ensureClip(anim, clip);
            anim.once(Animation.EventType.FINISHED, onDone, this);
            anim.play(clip.name);
            return;
        }

        onDone();
    }

    private _hideMagnet(): void {
        this._cancelMagnet();
        if (this.magnetRoot?.isValid) {
            this.magnetRoot.active = false;
        }
    }

    private _hideWisdom(): void {
        this._cancelWisdom();
        if (this.wisdomRoot?.isValid) {
            this.wisdomRoot.active = false;
        }
    }

    private _hideBuffRoots(): void {
        if (this.magnetRoot?.isValid) {
            this.magnetRoot.active = false;
        }
        this._hideMagnetCircleImmediate();
        if (this.wisdomRoot?.isValid) {
            this.wisdomRoot.active = false;
        }
    }

    private _showMagnetCircle(): void {
        if (!this.magnetCircleCenter?.isValid) {
            return;
        }
        const anim = this._magnetCircleAnim;
        this.magnetCircleCenter.active = true;
        this._clearMagnetCircleAnimCallbacks();
        anim?.stop();
        if (anim) {
            anim.enabled = true;
        }

        const appear = this.magnetCircleAppearClip;
        if (appear?.name && anim) {
            this._ensureClip(anim, appear);
            anim.once(
                Animation.EventType.FINISHED,
                this._onMagnetCircleAppearFinished,
                this,
            );
            anim.play(appear.name);
            return;
        }

        this._enterMagnetCircleLoop();
    }

    private _onMagnetCircleAppearFinished = (): void => {
        this._enterMagnetCircleLoop();
    };

    private _enterMagnetCircleLoop(): void {
        const anim = this._magnetCircleAnim;
        const loop = this._resolveMagnetCircleLoopClip();
        if (!loop?.name || !anim) {
            return;
        }
        this._ensureClip(anim, loop);
        const st = anim.getState(loop.name);
        if (st) {
            st.wrapMode = AnimationClip.WrapMode.Loop;
        }
        anim.play(loop.name);
    }

    private _resolveMagnetCircleLoopClip(): AnimationClip | null {
        if (this.magnetCircleLoopClip?.name) {
            return this.magnetCircleLoopClip;
        }
        const anim = this._magnetCircleAnim;
        if (!anim) {
            return null;
        }
        return anim.defaultClip ?? anim.clips[0] ?? null;
    }

    private _playMagnetCircleDisappear(onDone?: () => void): void {
        this._magnetCircleDisappearDone = onDone ?? null;
        if (!this.magnetCircleCenter?.isValid || !this.magnetCircleCenter.active) {
            this._hideMagnetCircleImmediate();
            return;
        }

        const anim = this._magnetCircleAnim;
        const clip = this.magnetCircleDisappearClip;
        if (!clip?.name || !anim) {
            this._hideMagnetCircleImmediate();
            return;
        }

        this._clearMagnetCircleAnimCallbacks();
        anim.stop();
        this._ensureClip(anim, clip);
        anim.once(
            Animation.EventType.FINISHED,
            this._onMagnetCircleDisappearFinished,
            this,
        );
        anim.play(clip.name);
    }

    private _onMagnetCircleDisappearFinished = (): void => {
        this._hideMagnetCircleImmediate();
        const done = this._magnetCircleDisappearDone;
        this._magnetCircleDisappearDone = null;
        done?.();
    };

    private _clearMagnetCircleAnimCallbacks(): void {
        const anim = this._magnetCircleAnim;
        if (!anim?.isValid) {
            return;
        }
        anim.off(
            Animation.EventType.FINISHED,
            this._onMagnetCircleAppearFinished,
            this,
        );
        anim.off(
            Animation.EventType.FINISHED,
            this._onMagnetCircleDisappearFinished,
            this,
        );
    }

    private _hideMagnetCircleImmediate(): void {
        this._magnetCircleDisappearDone = null;
        this._clearMagnetCircleAnimCallbacks();
        const anim = this._magnetCircleAnim;
        anim?.stop();
        if (anim) {
            anim.enabled = false;
        }
        if (this.magnetCircleCenter?.isValid) {
            this.magnetCircleCenter.active = false;
        }
    }

    private _bindWisdomContacts(): void {
        if (this._wisdomContactsBound || !this.wisdomCollider?.isValid) {
            return;
        }
        this._ensurePlayerContactListener();
        this.wisdomCollider.on(
            Contact2DType.BEGIN_CONTACT,
            this._onWisdomBegin,
            this,
        );
        this.wisdomCollider.on(
            Contact2DType.END_CONTACT,
            this._onWisdomEnd,
            this,
        );
        this._wisdomContactsBound = true;
    }

    private _unbindWisdomContacts(): void {
        if (!this._wisdomContactsBound || !this.wisdomCollider?.isValid) {
            this._wisdomContactsBound = false;
            return;
        }
        this.wisdomCollider.off(
            Contact2DType.BEGIN_CONTACT,
            this._onWisdomBegin,
            this,
        );
        this.wisdomCollider.off(
            Contact2DType.END_CONTACT,
            this._onWisdomEnd,
            this,
        );
        this._wisdomContactsBound = false;
    }

    private _onWisdomBegin = (
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ): void => {
        if (this._wisdomPhase !== 'loop' || !this._isWisdomObstacle(other)) {
            return;
        }
        this._wisdomObstacleHits++;
        this._syncWisdomObstacleFlag();
    };

    private _onWisdomEnd = (
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ): void => {
        if (!this._isWisdomObstacle(other)) {
            return;
        }
        this._wisdomObstacleHits = Math.max(0, this._wisdomObstacleHits - 1);
        this._syncWisdomObstacleFlag();
    };

    private _syncWisdomObstacleFlag(): void {
        GameManager.game?.notifyWisdomObstacleAhead(this._wisdomObstacleHits > 0);
    }

    /**
     * Sensor+sensor не даёт BEGIN_CONTACT (WisdomCollider + облако).
     * Каждый кадр проверяем AABB через PhysicsSystem2D.testAABB.
     */
    private _probeWisdomObstacleOverlap(): void {
        const col = this.wisdomCollider;
        if (!col?.enabled || !col.isValid) {
            this._syncWisdomObstacleFlag();
            return;
        }

        const aabb = this._worldAabb(col);
        if (!aabb) {
            this._syncWisdomObstacleFlag();
            return;
        }

        const system = PhysicsSystem2D.instance;
        if (!system) {
            this._syncWisdomObstacleFlag();
            return;
        }

        const rect = new Rect(
            aabb.xMin,
            aabb.yMin,
            Math.max(1, aabb.xMax - aabb.xMin),
            Math.max(1, aabb.yMax - aabb.yMin),
        );
        const hits = system.testAABB(rect);
        let ahead = this._wisdomObstacleHits > 0;
        for (const other of hits) {
            if (other === col || !other?.isValid) {
                continue;
            }
            if (this._isWisdomObstacle(other)) {
                ahead = true;
                break;
            }
        }
        GameManager.game?.notifyWisdomObstacleAhead(ahead);
    }

    private _ensurePlayerContactListener(): void {
        const rb =
            this.node.getComponent(RigidBody2D) ??
            this.node.getComponentInChildren(RigidBody2D);
        if (rb) {
            rb.enabledContactListener = true;
        }
    }

    private _worldAabb(col: Collider2D): {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
    } | null {
        const box = col as BoxCollider2D;
        if (box?.size) {
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
            const w = new Vec3();
            let xMin = Infinity;
            let xMax = -Infinity;
            let yMin = Infinity;
            let yMax = -Infinity;
            for (const c of corners) {
                Vec3.transformMat4(w, c, n.worldMatrix);
                xMin = Math.min(xMin, w.x);
                xMax = Math.max(xMax, w.x);
                yMin = Math.min(yMin, w.y);
                yMax = Math.max(yMax, w.y);
            }
            return { xMin, xMax, yMin, yMax };
        }

        const circle = col as CircleCollider2D;
        if (circle?.radius > 0) {
            const n = col.node;
            const w = n.worldPosition;
            const r = circle.radius * Math.max(Math.abs(n.worldScale.x), Math.abs(n.worldScale.y));
            const ox = circle.offset?.x ?? 0;
            const oy = circle.offset?.y ?? 0;
            return {
                xMin: w.x + ox - r,
                xMax: w.x + ox + r,
                yMin: w.y + oy - r,
                yMax: w.y + oy + r,
            };
        }

        return null;
    }

    private _isWisdomObstacle(other: Collider2D): boolean {
        if (!other?.isValid) {
            return false;
        }
        const n = other.node;
        if (n === this.node || n.isChildOf(this.node)) {
            return false;
        }
        if (this._isIgnorableForWisdom(other)) {
            return false;
        }
        if (this._isDamageHazard(other)) {
            return true;
        }
        if (other.sensor && this._isChunkObstacleSensor(other)) {
            return true;
        }
        if (other.sensor) {
            return false;
        }
        if (this.obstacleGroup < 0) {
            return true;
        }
        const g = (other as Collider2D & { group?: number; _group?: number }).group ??
            (other as Collider2D & { _group?: number })._group;
        return g === this.obstacleGroup;
    }

    /** Sensor-коллайдеры на чанках (облака, зоны башен) — без hazard-компонента на префабе. */
    private _isChunkObstacleSensor(other: Collider2D): boolean {
        let n: Node | null = other.node;
        while (n?.isValid) {
            const nm = n.name;
            if (
                nm === 'CloudBarrier' ||
                nm.includes('Cloud') ||
                nm.includes('Tower') ||
                nm.includes('Wall')
            ) {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    /** Семечки, бонусные итемы, столбы-вехи — не замедляют мир. */
    private _isIgnorableForWisdom(other: Collider2D): boolean {
        const pickup = PickupBase.resolve(other.node);
        if (pickup) {
            return true;
        }

        let n: Node | null = other.node;
        while (n?.isValid) {
            if (
                n.getComponent(MilestoneSign) ||
                n.getComponent(MilestoneDistanceLabel) ||
                n.getComponent(PickupBase) ||
                n.getComponent(MagnetPickable)
            ) {
                return true;
            }
            const nm = n.name;
            if (nm.endsWith('_item') || nm.endsWith('Item')) {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    private _isDamageHazard(other: Collider2D): boolean {
        let n: Node | null = other.node;
        while (n?.isValid) {
            if (
                n.getComponent(ElectricCloudHazard) ||
                n.getComponent(TowerWallHazard)
            ) {
                return true;
            }
            n = n.parent;
        }
        return false;
    }

    private _resolveCollider(root: Node | null, childName: string): Collider2D | null {
        if (!root?.isValid) {
            return null;
        }
        const child = root.getChildByName(childName);
        return (
            child?.getComponent(CircleCollider2D) ??
            child?.getComponent(BoxCollider2D) ??
            child?.getComponent(Collider2D) ??
            root.getComponent(CircleCollider2D) ??
            root.getComponent(BoxCollider2D) ??
            root.getComponent(Collider2D)
        );
    }

    private _ensureClip(anim: Animation, clip: AnimationClip): void {
        if (anim.clips.indexOf(clip) < 0) {
            anim.addClip(clip);
        }
    }

    private _setColliderEnabled(col: Collider2D | null, enabled: boolean): void {
        if (!col?.isValid) {
            return;
        }
        col.enabled = enabled;
        if (col instanceof CircleCollider2D || col instanceof BoxCollider2D) {
            col.sensor = true;
        }
    }

    private isPlaying(): boolean {
        return GameManager.game?.isPlaying === true;
    }
}
