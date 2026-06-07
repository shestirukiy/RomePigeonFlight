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
    Prefab,
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
import { SpringFollowParent } from './SpringFollowParent';
import { TowerWallHazard } from './TowerWallHazard';

const { ccclass, property } = _decorator;

type BuffPhase = 'idle' | 'appear' | 'loop' | 'disappear';
type EquippedBuffKind = 'magnet' | 'wisdom';

type DisappearFxSlot = {
    node: Node | null;
    playing: boolean;
    done: (() => void) | null;
};

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
    /** На Magnet сейчас те же клипы, что у Wisdom (см. Player.prefab). */
    private static readonly MAGNET_APPEAR_CLIP = 'WisdomAppear';
    private static readonly MAGNET_LOOP_CLIP = 'WisdomIdle';
    private static readonly MAGNET_DISAPPEAR_CLIP = 'WisdomDissaappear';
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
    private _wisdomProbeAhead = false;
    private readonly _disappearFx: Record<EquippedBuffKind, DisappearFxSlot> = {
        magnet: { node: null, playing: false, done: null },
        wisdom: { node: null, playing: false, done: null },
    };

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
            this.wisdomCollider =
                this._resolveCollider(this.node, PlayerEquippedBuffs.WISDOM_COLLIDER_NODE) ??
                this._resolveCollider(this.wisdomRoot, PlayerEquippedBuffs.WISDOM_COLLIDER_NODE);
        }
        this._magnetAnim = this.magnetRoot?.getComponent(Animation) ?? null;
        this._magnetCircleAnim = this.magnetCircleCenter?.getComponent(Animation) ?? null;
        this._wisdomAnim = this.wisdomRoot?.getComponent(Animation) ?? null;
    }

    onDestroy(): void {
        this._clearMagnetCircleAnimCallbacks();
        this._cancelBuffDisappearFxPlayback('magnet');
        this._cancelBuffDisappearFxPlayback('wisdom');
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
        const replacing = this._magnetPhase !== 'idle';
        if (replacing && this.magnetRoot?.isValid) {
            this._updateWorldTransformChain(this.magnetRoot);
            this._spawnLooseBuffDisappearFx('magnet');
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
            this._resolveBuffClip('magnet', 'appear'),
            this._resolveBuffClip('magnet', 'loop'),
            this._resolveBuffClip('magnet', 'disappear'),
            'magnet',
            () => this._setColliderEnabled(this.magnetCollider, true),
            () => this._setColliderEnabled(this.magnetCollider, false),
        );
    }

    public activateWisdom(): void {
        if (!this.isPlaying()) {
            return;
        }
        const replacing = this._wisdomPhase !== 'idle';
        if (replacing && this.wisdomRoot?.isValid) {
            this._updateWorldTransformChain(this.wisdomRoot);
            this._spawnLooseBuffDisappearFx('wisdom');
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
        this._wisdomProbeAhead = false;
        GameManager.game?.notifyWisdomObstacleAhead(false);
        this._setColliderEnabled(this.wisdomCollider, false);
        this._bindWisdomContacts();
        this._wisdomLoopRemain = duration;
        this._beginBuffSequence(
            this._wisdomAnim,
            this._resolveBuffClip('wisdom', 'appear'),
            this._resolveBuffClip('wisdom', 'loop'),
            this._resolveBuffClip('wisdom', 'disappear'),
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
            this._wisdomLoopRemain = 0;
            this._finishWisdomLoop();
        }
    }

    private _finishMagnetLoop(): void {
        SoundController.instance?.play(SoundId.MagnetDeactivate);
        MagnetPickable.clearEquippedMagnetZone();
        this._setColliderEnabled(this.magnetCollider, false);
        this._playMagnetCircleDisappear();
        this._playBuffDisappearFx('magnet', () => this._hideMagnet());
    }

    private _finishWisdomLoop(): void {
        if (this._wisdomPhase !== 'loop') {
            return;
        }
        SoundController.instance?.play(SoundId.WisdomDeactivate);
        this._setColliderEnabled(this.wisdomCollider, false);
        this._unbindWisdomContacts();
        GameManager.game?.notifyWisdomObstacleAhead(false);
        this._playBuffDisappearFx('wisdom', () => {
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
        this._cancelBuffDisappearFxPlayback('magnet');
        this._magnetAnim?.stop();
    }

    private _cancelWisdom(): void {
        this._wisdomPhase = 'idle';
        this._wisdomLoopRemain = 0;
        this._wisdomObstacleHits = 0;
        this._wisdomProbeAhead = false;
        this._cancelBuffDisappearFxPlayback('wisdom');
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

    /**
     * Detached disappear-FX (Magnet / Wisdom) — как HelmetBreakEffect:
     * equipped root скрывается, клон в PlayerContainer на local-позе родителя.
     */
    private _playBuffDisappearFx(kind: EquippedBuffKind, onDone: () => void): void {
        this._setBuffPhase(kind, 'disappear');
        const root = this._buffRoot(kind);
        const clip = this._resolveBuffClip(kind, 'disappear');
        const equippedAnim = this._buffAnim(kind);
        if (!clip?.name || !root?.isValid) {
            onDone();
            return;
        }

        equippedAnim?.stop();

        const fx = this._spawnDetachedBuffDisappearFx(root, this._buffDisappearFxPrefab(kind));
        if (!fx?.isValid) {
            root.active = false;
            onDone();
            return;
        }

        root.active = false;

        const anim = fx.getComponentInChildren(Animation);
        if (!anim) {
            fx.destroy();
            onDone();
            return;
        }

        this._ensureClip(anim, clip);
        const slot = this._disappearFx[kind];
        slot.node = fx;
        slot.playing = true;
        slot.done = onDone;

        anim.on(
            Animation.EventType.FINISHED,
            this._buffDisappearAnimFinishedHandlers[kind],
            this,
        );
        anim.stop();
        anim.play(clip.name);

        const duration = this._clipDurationSec(anim, clip);
        this.unschedule(this._buffDisappearTimedHandlers[kind]);
        this.scheduleOnce(this._buffDisappearTimedHandlers[kind], duration + 0.05);
    }

    /** Повторный pickup: старый buff «слетает» без ожидания (как replace шлема). */
    private _spawnLooseBuffDisappearFx(kind: EquippedBuffKind): void {
        const root = this._buffRoot(kind);
        const clip = this._resolveBuffClip(kind, 'disappear');
        const equippedAnim = this._buffAnim(kind);
        if (!clip?.name || !root?.isValid) {
            return;
        }

        equippedAnim?.stop();
        this._updateWorldTransformChain(root);

        const fx = this._spawnDetachedBuffDisappearFx(root, this._buffDisappearFxPrefab(kind));
        if (!fx?.isValid) {
            return;
        }

        root.active = false;
        SoundController.instance?.play(this._buffDeactivateSound(kind));

        const anim = fx.getComponentInChildren(Animation);
        if (!anim) {
            fx.destroy();
            return;
        }

        this._ensureClip(anim, clip);
        const duration = this._clipDurationSec(anim, clip);
        const cleanup = (): void => {
            if (fx?.isValid) {
                fx.destroy();
            }
        };

        anim.once(Animation.EventType.FINISHED, (_t, st) => {
            if (st?.name && st.name !== clip.name) {
                return;
            }
            cleanup();
        });
        anim.stop();
        anim.play(clip.name);
        this.scheduleOnce(cleanup, duration + 0.05);
    }

    private readonly _buffDisappearAnimFinishedHandlers = {
        magnet: (_type?: string, st?: { name?: string }): void => {
            this._onBuffDisappearFxAnimFinished('magnet', st);
        },
        wisdom: (_type?: string, st?: { name?: string }): void => {
            this._onBuffDisappearFxAnimFinished('wisdom', st);
        },
    };

    private readonly _buffDisappearTimedHandlers = {
        magnet: (): void => {
            this._finishBuffDisappearFx('magnet');
        },
        wisdom: (): void => {
            this._finishBuffDisappearFx('wisdom');
        },
    };

    private _onBuffDisappearFxAnimFinished(
        kind: EquippedBuffKind,
        st?: { name?: string },
    ): void {
        const slot = this._disappearFx[kind];
        if (!slot.playing) {
            return;
        }
        const clipName = this._resolveBuffClip(kind, 'disappear')?.name;
        if (st?.name && clipName && st.name !== clipName) {
            return;
        }
        this._finishBuffDisappearFx(kind);
    }

    private _finishBuffDisappearFx(kind: EquippedBuffKind): void {
        const slot = this._disappearFx[kind];
        if (!slot.playing) {
            return;
        }
        slot.playing = false;
        this.unschedule(this._buffDisappearTimedHandlers[kind]);
        const fx = slot.node;
        if (fx?.isValid) {
            const anim = fx.getComponentInChildren(Animation);
            anim?.off(
                Animation.EventType.FINISHED,
                this._buffDisappearAnimFinishedHandlers[kind],
                this,
            );
            anim?.stop();
            fx.destroy();
        }
        slot.node = null;
        const done = slot.done;
        slot.done = null;
        done?.();
    }

    /** Сброс/Play Again: уничтожить tracked FX без onDone. */
    private _cancelBuffDisappearFxPlayback(kind: EquippedBuffKind): void {
        const slot = this._disappearFx[kind];
        if (!slot.playing && !slot.node) {
            slot.done = null;
            return;
        }
        slot.playing = false;
        slot.done = null;
        this.unschedule(this._buffDisappearTimedHandlers[kind]);
        const fx = slot.node;
        if (fx?.isValid) {
            const anim = fx.getComponentInChildren(Animation);
            anim?.off(
                Animation.EventType.FINISHED,
                this._buffDisappearAnimFinishedHandlers[kind],
                this,
            );
            anim?.stop();
            fx.destroy();
        }
        slot.node = null;
    }

    /** Клон/prefab disappear-FX в PlayerContainer (якорь = parent root, local = root). */
    private _spawnDetachedBuffDisappearFx(root: Node, fxPrefab: Prefab | null): Node | null {
        const container = this._resolvePlayerContainer();
        if (!container?.isValid) {
            return null;
        }

        const animHost = root.parent;
        this._updateWorldTransformChain(root);

        const anchor = new Node(`${root.name}DisappearFxHost`);
        anchor.active = true;
        anchor.layer = root.layer;
        anchor.setParent(container, false);

        if (animHost?.isValid) {
            anchor.setWorldPosition(animHost.worldPosition);
            anchor.setWorldRotation(animHost.worldRotation);
            anchor.setWorldScale(animHost.worldScale);
        } else {
            anchor.setWorldPosition(root.worldPosition);
            anchor.setWorldRotation(root.worldRotation);
            anchor.setWorldScale(root.worldScale);
        }

        const fx = fxPrefab ? instantiate(fxPrefab) : instantiate(root);
        if (!fx?.isValid) {
            anchor.destroy();
            return null;
        }

        fx.active = true;
        fx.layer = root.layer;
        fx.setParent(anchor, false);
        fx.setPosition(root.position);
        fx.setRotation(root.rotation);
        fx.setScale(root.scale);
        this._prepareBuffDisappearFxClone(fx);

        const anim = fx.getComponent(Animation);
        if (anim) {
            anim.enabled = true;
        }

        return anchor;
    }

    /** На клоне не крутить SpringFollowParent и коллайдеры — визуал остаётся включённым. */
    private _prepareBuffDisappearFxClone(root: Node): void {
        this._disableFxColliders(root);
        for (const spring of root.getComponentsInChildren(SpringFollowParent)) {
            spring.enabled = false;
        }
    }

    private _buffRoot(kind: EquippedBuffKind): Node | null {
        return kind === 'magnet' ? this.magnetRoot : this.wisdomRoot;
    }

    private _buffAnim(kind: EquippedBuffKind): Animation | null {
        return kind === 'magnet' ? this._magnetAnim : this._wisdomAnim;
    }

    private _setBuffPhase(kind: EquippedBuffKind, phase: BuffPhase): void {
        if (kind === 'magnet') {
            this._magnetPhase = phase;
            return;
        }
        this._wisdomPhase = phase;
    }

    private _buffDisappearFxPrefab(kind: EquippedBuffKind): Prefab | null {
        const cfg = BonusItemScheduler.instance;
        if (kind === 'magnet') {
            return cfg?.magnetDisappearFxPrefab ?? null;
        }
        return cfg?.wisdomDisappearFxPrefab ?? null;
    }

    private _buffDeactivateSound(kind: EquippedBuffKind): SoundId {
        return kind === 'magnet' ? SoundId.MagnetDeactivate : SoundId.WisdomDeactivate;
    }

    private _resolveBuffClip(
        kind: EquippedBuffKind,
        phase: 'appear' | 'loop' | 'disappear',
    ): AnimationClip | null {
        const cfg = BonusItemScheduler.instance;
        const anim = this._buffAnim(kind);
        if (kind === 'magnet') {
            const fromScheduler =
                phase === 'appear'
                    ? cfg?.magnetAppearClip
                    : phase === 'loop'
                      ? cfg?.magnetLoopClip
                      : cfg?.magnetDisappearClip;
            const fallback =
                phase === 'appear'
                    ? PlayerEquippedBuffs.MAGNET_APPEAR_CLIP
                    : phase === 'loop'
                      ? PlayerEquippedBuffs.MAGNET_LOOP_CLIP
                      : PlayerEquippedBuffs.MAGNET_DISAPPEAR_CLIP;
            return this._resolveClipFromScheduler(anim, fromScheduler, fallback);
        }

        const fromScheduler =
            phase === 'appear'
                ? cfg?.wisdomAppearClip
                : phase === 'loop'
                  ? cfg?.wisdomLoopClip
                  : cfg?.wisdomDisappearClip;
        const fallback =
            phase === 'appear'
                ? PlayerEquippedBuffs.WISDOM_APPEAR_CLIP
                : phase === 'loop'
                  ? PlayerEquippedBuffs.WISDOM_LOOP_CLIP
                  : PlayerEquippedBuffs.WISDOM_DISAPPEAR_CLIP;
        return this._resolveClipFromScheduler(anim, fromScheduler, fallback);
    }

    private _resolveClipFromScheduler(
        anim: Animation | null,
        fromScheduler: AnimationClip | null | undefined,
        fallbackName: string,
    ): AnimationClip | null {
        if (fromScheduler?.name) {
            return fromScheduler;
        }
        return this._findAnimClip(anim, fallbackName);
    }

    private _clipDurationSec(anim: Animation, clip: AnimationClip): number {
        let duration = 0.9;
        const st = anim.getState(clip.name);
        if (st && st.duration > 0) {
            duration = Math.max(0.05, st.duration / Math.max(Math.abs(st.speed), 1e-5));
        } else if (clip.duration > 0) {
            duration = Math.max(0.05, clip.duration);
        }
        return duration;
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

    private _hideMagnet(): void {
        this._cancelMagnet();
        if (this.magnetRoot?.isValid) {
            this.magnetRoot.active = false;
        }
    }

    private _hideWisdom(): void {
        this._wisdomPhase = 'idle';
        this._wisdomLoopRemain = 0;
        this._wisdomAnim?.stop();
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
        let ahead = false;
        for (const other of hits) {
            if (other === col || !other?.isValid) {
                continue;
            }
            if (this._isWisdomObstacle(other)) {
                ahead = true;
                break;
            }
        }
        if (!ahead) {
            this._wisdomObstacleHits = 0;
        }
        if (ahead !== this._wisdomProbeAhead) {
            this._wisdomProbeAhead = ahead;
            GameManager.game?.notifyWisdomObstacleAhead(ahead);
        }
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
