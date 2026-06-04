import { _decorator, Animation, AnimationClip, Node, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { PlayerAnimationController } from './PlayerAnimationController';
import { PlayerFlight } from './PlayerFlight';

const { ccclass, property } = _decorator;

/**
 * Чистовая анимация на узле Fedia (поверх старого Pigeon).
 * Между бегом по поверхности и полётом — один цикл FediaStartFly (вперёд / назад).
 */
@ccclass('FediaAnimationController')
export class FediaAnimationController extends PlayerAnimationController {
    @property({
        type: AnimationClip,
        displayName: 'Start Fly Clip',
        tooltip:
            'FediaStartFly: бег→полёт — вперёд (1 цикл); полёт→бег — тот же клип назад.',
    })
    startFlyClip: AnimationClip | null = null;

    private _startFlyTransitionActive = false;
    private _startFlyTransitionTarget = false;
    private _startFlyFinishedBound = false;
    /** Полёт→бег: отрицательный speed в движке не крутит клип — двигаем time вручную. */
    private _startFlyManualReverse = false;
    private _startFlyManualTime = 0;
    private _startFlyPlaySpeed = 1;
    /** Первый взлёт после тапа «старт» — FediaStartFly вместо сразу FediaFly. */
    private _runStartTakeoffPending = false;
    private readonly _onStartFlyTransitionEnd = (): void => {
        this._finishStartFlyTransition();
    };
    private readonly _onStartFlyAnimFinished = (
        _type?: string,
        st?: { name?: string },
    ): void => {
        const want = this.startFlyClip?.name;
        if (want && st?.name && st.name !== want) {
            return;
        }
        this._finishStartFlyTransition();
    };

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

    protected override _blocksRoutineFlightAnimUpdate(): boolean {
        return this._startFlyTransitionActive;
    }

    protected override _tryPlaySurfaceRunTransition(active: boolean): boolean {
        if (
            this._deathSequenceActive ||
            GameManager.game?.isDying ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0
        ) {
            return false;
        }
        if (!active) {
            const wasGrounded =
                this._feetOnSurface ||
                this._surfaceRunActive ||
                this._isStayClipPlaying() ||
                this._runStartTakeoffPending;
            if (!this._startFlyTransitionActive && !wasGrounded) {
                return false;
            }
        } else if (
            this._runStartTakeoffPending ||
            (!this._startFlyTransitionActive &&
                this._surfaceRunActive === active)
        ) {
            return false;
        }
        if (!this.startFlyClip?.name || !this._anim) {
            return false;
        }
        if (this._startFlyTransitionActive) {
            this._startFlyTransitionTarget = active;
            return true;
        }

        this._startFlyTransitionActive = true;
        this._startFlyTransitionTarget = active;
        this._flapState = null;
        if (!active) {
            this._runStartTakeoffPending = false;
        }
        this._playStartFlyTransition(active);
        return true;
    }

    public override onGameRunStarted(): void {
        this._runStartTakeoffPending = true;
        /* Тап «старт» — с платформы; PathSensors ещё не успели выставить опору. */
        this._feetOnSurface = true;
    }

    public override setRunningOnSurface(active: boolean): void {
        if (this._runStartTakeoffPending) {
            if (active) {
                this._feetOnSurface = true;
                return;
            }
        }
        super.setRunningOnSurface(active);
    }

    public override notifyElectricDamage(overlayDurationSec: number): void {
        this._cancelStartFlyTransition();
        super.notifyElectricDamage(overlayDurationSec);
    }

    public override notifyWallHit(overlayDurationSec: number): void {
        this._cancelStartFlyTransition();
        super.notifyWallHit(overlayDurationSec);
    }

    public override playDeath(onComplete?: () => void): boolean {
        this._cancelStartFlyTransition();
        return super.playDeath(onComplete);
    }

    public override resetForNewRun(): void {
        this._cancelStartFlyTransition();
        this._runStartTakeoffPending = false;
        super.resetForNewRun();
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
        this.startFlyClip = this._pickClip(
            this.startFlyClip,
            'FediaStartFly',
            'StartFly',
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

    private _isStayClipPlaying(): boolean {
        if (!this._anim || !this.stayClip?.name) {
            return false;
        }
        const st = this._anim.getState(this.stayClip.name);
        return st?.isPlaying === true;
    }

    private _stopClipIfPlaying(clip: AnimationClip | null): void {
        if (!clip?.name || !this._anim) {
            return;
        }
        const st = this._anim.getState(clip.name);
        if (st?.isPlaying) {
            st.stop();
        }
    }

    private _playSurfaceStayLoop(): void {
        if (!this._anim || !this.stayClip?.name) {
            return;
        }
        this._ensureClipOnAnimator(this.stayClip);
        this._flapState = null;
        const name = this.stayClip.name;
        this._anim.play(name);
        const st = this._anim.getState(name);
        if (!st) {
            return;
        }
        st.wrapMode = AnimationClip.WrapMode.Loop;
        st.speed = 1;
        st.resume();
    }

    protected override _applyRunningOnSurface(active: boolean): void {
        if (!active) {
            super._applyRunningOnSurface(false);
            return;
        }
        if (GameManager.game?.isForwardScrollHalted) {
            this._surfaceRunActive = false;
            this._feetOnSurface = true;
            this._playSurfaceStayLoop();
            return;
        }
        super._applyRunningOnSurface(true);
    }

    private _syncFeetOnSurfaceStay(): void {
        if (
            !GameManager.game?.isPlaying ||
            this._deathSequenceActive ||
            this._startFlyTransitionActive ||
            !this._feetOnSurface ||
            this._surfaceRunActive ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0
        ) {
            return;
        }
        this._playSurfaceStayLoop();
    }

    /**
     * @param toSurface true — полёт→бег (клип назад); false — бег→полёт (вперёд).
     */
    private _playStartFlyTransition(toSurface: boolean): void {
        const clip = this.startFlyClip!;
        const anim = this._anim!;
        this._ensureClipOnAnimator(clip);
        this.unschedule(this._onStartFlyTransitionEnd);
        this._detachStartFlyFinished(anim);

        const name = clip.name;
        this._stopClipIfPlaying(this.surfaceRunClip);
        this._stopClipIfPlaying(this.stayClip);

        anim.stop();
        anim.play(name);
        const st = anim.getState(name);
        if (!st) {
            this._finishStartFlyTransition();
            return;
        }

        const clipLen = Math.max(
            clip.duration > 1e-5 ? clip.duration : 0,
            st.duration > 1e-5 ? st.duration : 0,
            0.05,
        );
        const baseSpeed = Math.max(
            clip.speed > 1e-5 ? Math.abs(clip.speed) : 0,
            1,
        );
        const duration = Math.max(0.08, clipLen / baseSpeed);
        this._startFlyPlaySpeed = baseSpeed;
        st.wrapMode = AnimationClip.WrapMode.Normal;
        st.repeatCount = 1;

        if (toSurface) {
            this._startFlyManualReverse = true;
            this._startFlyManualTime = clipLen;
            st.speed = 0;
            st.time = clipLen;
            st.sample();
            st.pause();
            this.scheduleOnce(this._onStartFlyTransitionEnd, duration + 0.08);
        } else {
            this._startFlyManualReverse = false;
            st.speed = baseSpeed;
            st.time = 0;
            st.sample();
            st.resume();
            anim.once(
                Animation.EventType.FINISHED,
                this._onStartFlyAnimFinished,
                this,
            );
            this._startFlyFinishedBound = true;
            this.scheduleOnce(this._onStartFlyTransitionEnd, duration + 0.05);
        }
    }

    private _tickStartFlyManualReverse(dt: number): void {
        if (
            !this._startFlyManualReverse ||
            !this._startFlyTransitionActive ||
            !this._anim ||
            !this.startFlyClip?.name
        ) {
            return;
        }
        const st = this._anim.getState(this.startFlyClip.name);
        if (!st) {
            this._finishStartFlyTransition();
            return;
        }

        this._startFlyManualTime -= dt * this._startFlyPlaySpeed;
        if (this._startFlyManualTime <= 0) {
            st.time = 0;
            st.sample();
            this._startFlyManualReverse = false;
            this._finishStartFlyTransition();
            return;
        }
        st.time = this._startFlyManualTime;
        st.sample();
    }

    private _detachStartFlyFinished(anim: Animation): void {
        if (!this._startFlyFinishedBound) {
            return;
        }
        anim.off(Animation.EventType.FINISHED, this._onStartFlyAnimFinished, this);
        this._startFlyFinishedBound = false;
    }

    private _finishStartFlyTransition(): void {
        if (!this._startFlyTransitionActive) {
            return;
        }
        this.unschedule(this._onStartFlyTransitionEnd);
        if (this._anim) {
            this._detachStartFlyFinished(this._anim);
        }
        this._startFlyTransitionActive = false;
        this._startFlyManualReverse = false;
        const target = this._startFlyTransitionTarget;
        this._applyRunningOnSurface(target);
    }

    private _cancelStartFlyTransition(): void {
        if (!this._startFlyTransitionActive) {
            return;
        }
        this.unschedule(this._onStartFlyTransitionEnd);
        if (this._anim) {
            this._detachStartFlyFinished(this._anim);
        }
        this._startFlyTransitionActive = false;
        this._startFlyManualReverse = false;
        this._runStartTakeoffPending = false;
        this._flapState = null;
    }

    private _tryRunStartTakeoffTransition(): void {
        if (
            !this._runStartTakeoffPending ||
            this._startFlyTransitionActive ||
            GameManager.game?.isPlaying !== true
        ) {
            return;
        }
        this._tryPlaySurfaceRunTransition(false);
    }

    update(dt: number): void {
        this._tickStartFlyManualReverse(dt);
        this._tryRunStartTakeoffTransition();
        this._syncFeetOnSurfaceStay();
        super.update(dt);
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
