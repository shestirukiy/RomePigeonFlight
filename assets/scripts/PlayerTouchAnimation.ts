import {
    _decorator,
    Animation,
    AnimationClip,
    AudioClip,
    BoxCollider2D,
    CircleCollider2D,
    Collider2D,
    Component,
    Contact2DType,
    IPhysics2DContact,
    Node,
    RigidBody2D,
    Vec3,
} from 'cc';
import { GameSession } from './GameSession';
import { PlayerController } from './PlayerController';
import { SceneNodeHub } from './SceneNodeHub';
import { SoundController } from './SoundController';

const { ccclass, property } = _decorator;

const G_ANIM = { id: 'Animation', name: 'Animation' };
const G_TRIG = { id: 'Trigger', name: 'Player trigger' };
const G_SOUND = { id: 'Sound', name: 'Sound' };

/**
 * На ноде с Animation: loop при появлении, одноразовый клип при касании игроком коллайдера.
 */
@ccclass('PlayerTouchAnimation')
export class PlayerTouchAnimation extends Component {
    @property({
        group: G_ANIM,
        type: Animation,
        displayName: 'Animation',
        tooltip: 'Пусто — Animation на этом узле.',
    })
    animation: Animation | null = null;

    @property({
        group: G_ANIM,
        type: AnimationClip,
        displayName: 'Loop Clip',
        tooltip: 'По умолчанию крутится бесконечно при включении ноды.',
    })
    loopClip: AnimationClip | null = null;

    @property({
        group: G_ANIM,
        type: AnimationClip,
        displayName: 'Trigger Clip',
        tooltip: 'Проигрывается один раз при касании игроком.',
    })
    triggerClip: AnimationClip | null = null;

    @property({
        group: G_ANIM,
        displayName: 'Resume Loop After Trigger',
        tooltip: 'После Trigger Clip снова запустить Loop Clip.',
    })
    resumeLoopAfterTrigger = true;

    @property({
        group: G_TRIG,
        type: Collider2D,
        displayName: 'Trigger Collider',
        tooltip: 'Коллайдер на отдельной ноде (или на этом). Sensor или solid.',
    })
    triggerCollider: Collider2D | null = null;

    @property({
        group: G_TRIG,
        displayName: 'Trigger Once',
        tooltip: 'Сработать только один раз за жизнь ноды.',
    })
    triggerOnce = true;

    @property({
        group: G_TRIG,
        displayName: 'Only While Playing',
        tooltip: 'Игнорировать касания до старта забега.',
    })
    onlyWhilePlaying = true;

    @property({
        group: G_TRIG,
        displayName: 'Overlap Probe',
        tooltip:
            'Доп. проверка AABB каждый кадр — для статичных тел на скроллящихся чанках (как у MilestoneSign).',
    })
    overlapProbe = true;

    @property({
        group: G_SOUND,
        type: AudioClip,
        displayName: 'Trigger Sound',
        tooltip: 'SFX при срабатывании триггера. Играет до конца (отдельный AudioSource).',
    })
    triggerSound: AudioClip | null = null;

    @property({
        group: G_SOUND,
        displayName: 'Trigger Sound Volume',
        slide: true,
        min: 0,
        max: 2,
        step: 0.05,
        tooltip: 'Громкость Trigger Sound (× SFX Volume в SoundController).',
    })
    triggerSoundVolume = 1;

    private _triggered = false;
    private _playingTrigger = false;
    private _boundCollider: Collider2D | null = null;

    private readonly _onTriggerClipFinished = (
        _type?: string,
        st?: { name?: string },
    ): void => {
        const clip = this.triggerClip;
        if (clip?.name && st?.name && st.name !== clip.name) {
            return;
        }
        this._playingTrigger = false;
        const anim = this._resolveAnimation();
        if (anim?.isValid) {
            anim.off(Animation.EventType.FINISHED, this._onTriggerClipFinished, this);
        }
        if (this.resumeLoopAfterTrigger) {
            this._playLoop();
        }
    };

    onLoad() {
        this._resolveRefs();
        this._bindCollider();
    }

    onEnable() {
        this._triggered = false;
        this._playingTrigger = false;
        this._resolveRefs();
        this._bindCollider();
        this._playLoop();
    }

    onDisable() {
        this._unbindCollider();
        const anim = this._resolveAnimation();
        anim?.off(Animation.EventType.FINISHED, this._onTriggerClipFinished, this);
    }

    onDestroy() {
        this._unbindCollider();
    }

    lateUpdate() {
        if (!this.overlapProbe || this._playingTrigger) {
            return;
        }
        if (this.triggerOnce && this._triggered) {
            return;
        }
        if (this.onlyWhilePlaying && GameSession.game?.isPlaying !== true) {
            return;
        }
        this._probePlayerOverlap();
    }

    private _resolveRefs(): void {
        if (!this.animation?.isValid) {
            this.animation =
                this.getComponent(Animation) ??
                this.getComponentInChildren(Animation);
        }
        if (!this.triggerCollider?.isValid) {
            this.triggerCollider =
                this.getComponent(Collider2D) ??
                this.getComponentInChildren(Collider2D);
        }
        this._ensureContactListener(this.triggerCollider);
    }

    private _ensureContactListener(col: Collider2D | null): void {
        if (!col?.isValid) {
            return;
        }
        let n: Node | null = col.node;
        while (n?.isValid) {
            const rb = n.getComponent(RigidBody2D);
            if (rb) {
                rb.enabledContactListener = true;
                return;
            }
            n = n.parent;
        }
    }

    private _resolveAnimation(): Animation | null {
        if (this.animation?.isValid) {
            return this.animation;
        }
        return null;
    }

    private _bindCollider(): void {
        const col = this.triggerCollider;
        if (!col?.isValid || this._boundCollider === col) {
            return;
        }
        this._unbindCollider();
        this._boundCollider = col;
        col.on(Contact2DType.BEGIN_CONTACT, this._onBeginContact, this);
    }

    private _unbindCollider(): void {
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

    private _onBeginContact(
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ): void {
        if (!this._isPlayerCollider(other)) {
            return;
        }
        this._tryPlayTrigger();
    }

    private _probePlayerOverlap(): void {
        const col = this.triggerCollider;
        if (!col?.isValid || !col.enabled) {
            return;
        }
        const player = SceneNodeHub.instance?.player;
        if (!player?.isValid) {
            return;
        }
        const playerCol =
            player.getComponent(BoxCollider2D) ??
            player.getComponent(CircleCollider2D) ??
            player.getComponentInChildren(BoxCollider2D) ??
            player.getComponentInChildren(CircleCollider2D);
        if (!playerCol?.isValid) {
            return;
        }
        const ta = this._colliderWorldAabb(col);
        const pa = this._colliderWorldAabb(playerCol);
        if (!ta || !pa || !this._aabbOverlap(ta, pa)) {
            return;
        }
        this._tryPlayTrigger();
    }

    private _tryPlayTrigger(): void {
        if (this._playingTrigger) {
            return;
        }
        if (this.triggerOnce && this._triggered) {
            return;
        }
        if (this.onlyWhilePlaying && GameSession.game?.isPlaying !== true) {
            return;
        }
        const clip = this.triggerClip;
        const sound = this.triggerSound;
        if (!clip?.name && !sound) {
            return;
        }

        this._triggered = true;
        this._playingTrigger = !!clip?.name;
        this._playTriggerSound();

        if (!clip?.name) {
            return;
        }

        const anim = this._resolveAnimation();
        if (!anim) {
            this._playingTrigger = false;
            return;
        }

        this._ensureClipOnAnim(anim, clip);
        anim.off(Animation.EventType.FINISHED, this._onTriggerClipFinished, this);
        anim.on(Animation.EventType.FINISHED, this._onTriggerClipFinished, this);
        anim.stop();

        const st = anim.getState(clip.name);
        if (st) {
            st.wrapMode = AnimationClip.WrapMode.Normal;
            st.repeatCount = 1;
        }
        anim.play(clip.name);
    }

    private _playTriggerSound(): void {
        const clip = this.triggerSound;
        if (!clip) {
            return;
        }
        SoundController.instance?.playClipToCompletion(
            clip,
            this.triggerSoundVolume,
        );
    }

    private _playLoop(): void {
        const clip = this.loopClip;
        const anim = this._resolveAnimation();
        if (!anim || !clip?.name) {
            return;
        }

        this._ensureClipOnAnim(anim, clip);
        anim.off(Animation.EventType.FINISHED, this._onTriggerClipFinished, this);

        const st = anim.getState(clip.name);
        if (st) {
            st.wrapMode = AnimationClip.WrapMode.Loop;
        }
        anim.play(clip.name);
    }

    private _ensureClipOnAnim(anim: Animation, clip: AnimationClip): void {
        if (anim.clips.indexOf(clip) < 0) {
            anim.addClip(clip);
        }
    }

    private _isPlayerCollider(other: Collider2D): boolean {
        if (PlayerController.findFromColliderNode(other.node)) {
            return true;
        }
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

    private _colliderWorldAabb(col: Collider2D): {
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
            const wp = n.worldPosition;
            const scale = Math.max(Math.abs(n.worldScale.x), Math.abs(n.worldScale.y));
            const r = circle.radius * scale;
            const ox = circle.offset?.x ?? 0;
            const oy = circle.offset?.y ?? 0;
            const cx = wp.x + ox;
            const cy = wp.y + oy;
            return {
                xMin: cx - r,
                xMax: cx + r,
                yMin: cy - r,
                yMax: cy + r,
            };
        }

        return null;
    }
}
