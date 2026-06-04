import { _decorator, Animation, AnimationClip, Node, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { PlayerAnimationController } from './PlayerAnimationController';
import { PlayerFlight } from './PlayerFlight';

const { ccclass } = _decorator;

/**
 * Чистовая анимация на узле Fedia (поверх старого Pigeon).
 * Логика полёта/удара/бега — как у PlayerAnimationController, но клипы на Fedia / FediaAnim.
 */
@ccclass('FediaAnimationController')
export class FediaAnimationController extends PlayerAnimationController {
    protected override _resolvePigeonRoot(): Node | null {
        if (this.node.name === 'Fedia') {
            return this.node;
        }
        return this.node.getChildByName('Fedia') ?? this.node;
    }

    protected override _resolvePigeonBodyNode(): Node | null {
        const root = this._resolvePigeonRoot();
        if (!root?.isValid) {
            return null;
        }
        return (
            root.getChildByName('FediaAnim') ??
            root.getChildByName('FediaBody') ??
            root.children[0] ??
            null
        );
    }

    protected override _resolveDeathFallNode(): Node | null {
        if (this.deathFallNode?.isValid) {
            return this.deathFallNode;
        }
        return this._resolvePigeonBodyNode();
    }

    protected override _hideWingForDeath(): void {
        /* У Fedia нет PigeonFlyWing — только клип смерти. */
    }

    protected override _restoreWingVisibility(): void {
        /* no-op */
    }

    protected override _resolveAnimTarget(): Animation | null {
        const root = this._resolvePigeonRoot();
        if (!root?.isValid) {
            return null;
        }
        return (
            root.getComponent(Animation) ??
            this.getComponent(Animation) ??
            this.getComponentInChildren(Animation)
        );
    }

    onLoad() {
        const root = this._resolvePigeonRoot() ?? this.node;
        this._anim = this._resolveAnimTarget();
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;

        this._bindClipRefsFromAnimator();

        const fallNode = this._resolveDeathFallNode();
        if (fallNode) {
            this._deathFallSpawnLocal.set(fallNode.position);
        }
        this._hideHpHarvestTemplate();
    }

    start() {
        this._bindClipRefsFromAnimator();
        if (GameManager.game?.isPlaying !== true) {
            this.playWaitingStay();
        }
    }

    /** Stay / удар / урон — подставить клип с Animation, если в инспекторе не тот ассет. */
    private _bindClipRefsFromAnimator(): void {
        if (!this._anim) {
            return;
        }
        this.stayClip = this._pickClip(this.stayClip, 'FediaStay', 'Stay');
        this.flapClip = this._pickClip(this.flapClip, 'FediaFly', 'Fly');
        this.surfaceRunClip = this._pickClip(
            this.surfaceRunClip,
            'FediaRun',
            'Run',
        );
        this.electricDamageClip = this._pickClip(
            this.electricDamageClip,
            'FediaFlashDamage',
            'FlashDamage',
        );
        this.wallHitClip = this._pickClip(
            this.wallHitClip,
            'FediaStun',
            'Stun',
        );
        this.deathClip = this._pickClip(this.deathClip, 'FediaDeath', 'Death');
    }

    private _pickClip(
        current: AnimationClip | null,
        ...names: string[]
    ): AnimationClip | null {
        const wanted = new Set(names);
        if (current?.name && wanted.has(current.name)) {
            if (this._animHasClip(current)) {
                return current;
            }
        }
        for (const clip of this._anim!.clips) {
            if (clip?.name && wanted.has(clip.name)) {
                return clip;
            }
        }
        return current;
    }

    private _animHasClip(clip: AnimationClip): boolean {
        return this._anim!.clips.indexOf(clip) >= 0;
    }

    public override playWaitingStay(): void {
        this._bindClipRefsFromAnimator();
        if (!this.stayClip?.name || !this._anim) {
            return;
        }
        if (!this._anim.getState(this.stayClip.name)) {
            this._ensureClipOnAnimator(this.stayClip);
        }
        super.playWaitingStay();
    }

    public override playHpHarvest(
        _targetWorldPos: Vec3,
        _slotIndex: number,
        _onComplete: () => void,
    ): boolean {
        return false;
    }
}
