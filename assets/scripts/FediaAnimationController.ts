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

    @property({
        type: AnimationClip,
        displayName: 'Surface Run Fly Clip',
        tooltip: 'Вариант бега FediaRunFly. Должен быть в Clips у Animation на Fedia.',
    })
    surfaceRunClipFly: AnimationClip | null = null;

    private _surfaceRunVariants: AnimationClip[] = [];

    private _startFlyTransitionActive = false;
    /** Целевое состояние после полного доигрывания (не отката). */
    private _startFlyTransitionTarget = false;
    /** true — исходная поза на земле (t=0); false — в воздухе (t=конец клипа). */
    private _startFlyOriginGrounded = true;
    private _startFlyRewinding = false;
    private _startFlyClipLen = 0.8;
    private _startFlyManualTime = 0;
    private _startFlyPlaySpeed = 1;
    /** +1 к концу перехода, −1 откат к origin. */
    private _startFlyPlaybackSign = 1;
    /** Первый взлёт после тапа «старт» — FediaStartFly вместо сразу FediaFly. */
    private _runStartTakeoffPending = false;
    /** Wisdom slow: FediaStartFly → FediaRunFly / обратно (как бег ↔ полёт). */
    private _startFlyForWisdomRunFly = false;
    private _wisdomRunFlyAnimActive = false;
    private _lastWisdomRunFlyForced = false;
    private readonly _onStartFlyTransitionEnd = (): void => {
        if (this._startFlyRewinding) {
            this._completeStartFlyRewind();
        } else {
            this._finishStartFlyTransition();
        }
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
        return this._startFlyTransitionActive || this._wisdomRunFlyAnimActive;
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
        if (this._startFlyForWisdomRunFly) {
            return true;
        }
        if (this._wisdomRunFlyAnimActive && !active) {
            return true;
        }
        if (this._wisdomRunFlyAnimActive && active) {
            this._wisdomRunFlyAnimActive = false;
            this._lastWisdomRunFlyForced = false;
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
            if (active === this._startFlyTransitionTarget && !this._startFlyRewinding) {
                return true;
            }
            this._beginStartFlyRewind();
            return true;
        }

        this._startFlyTransitionActive = true;
        this._startFlyTransitionTarget = active;
        this._startFlyRewinding = false;
        this._startFlyForWisdomRunFly = false;
        this._wisdomRunFlyAnimActive = false;
        this._flapState = null;
        if (!active) {
            this._runStartTakeoffPending = false;
            /* Иначе после отката FediaStartFly _applyRunningOnSurface(true) не перезапустит бег. */
            this._surfaceRunActive = false;
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
        this._bindClipRefsFromAnimator();
        return super.playDeath(onComplete);
    }

    public override resetForNewRun(): void {
        this._cancelStartFlyTransition();
        this._runStartTakeoffPending = false;
        this._wisdomRunFlyAnimActive = false;
        this._startFlyForWisdomRunFly = false;
        this._lastWisdomRunFlyForced = false;
        super.resetForNewRun();
    }

    onLoad() {
        const root = this._resolvePigeonRoot() ?? this.node;
        this._anim = this._resolveAnimTarget();
        this._flight = this._resolvePlayerFlight();

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
        this.surfaceRunClipFly = this._pickClip(
            this.surfaceRunClipFly,
            'FediaRunFly',
        );
        this._rebuildSurfaceRunVariants();
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

    private _rebuildSurfaceRunVariants(): void {
        const list: AnimationClip[] = [];
        const seen = new Set<string>();
        for (const clip of [this.surfaceRunClip, this.surfaceRunClipFly]) {
            if (!clip?.name || seen.has(clip.name)) {
                continue;
            }
            seen.add(clip.name);
            list.push(clip);
        }
        this._surfaceRunVariants = list;
    }

    protected override _resolveSurfaceRunClipForTransition(): AnimationClip | null {
        if (this._surfaceRunVariants.length === 0) {
            this._rebuildSurfaceRunVariants();
        }
        if (this._surfaceRunVariants.length === 0) {
            return this.surfaceRunClip;
        }
        const idx = Math.floor(Math.random() * this._surfaceRunVariants.length);
        return this._surfaceRunVariants[idx] ?? this.surfaceRunClip;
    }

    protected override _resolveFlapClip(): AnimationClip | null {
        return this._wisdomRunFlyClip() ?? this.flapClip;
    }

    /** FediaRunFly в полёте после StartFly-перехода; на земле — обычный бег. */
    private _wisdomRunFlyClip(): AnimationClip | null {
        if (
            !this._wisdomRunFlyAnimActive ||
            this._surfaceRunActive ||
            !this.surfaceRunClipFly?.name
        ) {
            return null;
        }
        return this.surfaceRunClipFly;
    }

    /** FediaFly → FediaRunFly через StartFly (как посадка); обратно — как взлёт. */
    private _syncWisdomRunFlyTransition(): void {
        const gm = GameManager.game;
        if (
            !gm?.isPlaying ||
            this._deathSequenceActive ||
            gm.isDying ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0 ||
            this._surfaceRunActive
        ) {
            return;
        }

        if (!gm.isWisdomBuffActive) {
            this._lastWisdomRunFlyForced = false;
            if (
                this._wisdomRunFlyAnimActive &&
                !this._startFlyTransitionActive &&
                !this._startFlyForWisdomRunFly
            ) {
                this._tryPlayWisdomRunFlyTransition(false);
            } else if (!this._startFlyTransitionActive) {
                this._wisdomRunFlyAnimActive = false;
            }
            return;
        }

        if (this._startFlyTransitionActive) {
            return;
        }

        const forced = gm.isWisdomRunFlyForced();
        if (forced === this._lastWisdomRunFlyForced) {
            return;
        }

        this._tryPlayWisdomRunFlyTransition(forced);
    }

    private _tryPlayWisdomRunFlyTransition(enterRunFly: boolean): boolean {
        if (this._surfaceRunActive) {
            return false;
        }

        if (!this.startFlyClip?.name || !this._anim) {
            this._wisdomRunFlyAnimActive = enterRunFly;
            this._lastWisdomRunFlyForced = enterRunFly;
            this._resumeWisdomOrFlapPlayback(true);
            return true;
        }

        if (this._startFlyTransitionActive) {
            if (
                this._startFlyForWisdomRunFly &&
                enterRunFly === this._startFlyTransitionTarget &&
                !this._startFlyRewinding
            ) {
                return true;
            }
            if (this._startFlyForWisdomRunFly || !this._startFlyRewinding) {
                this._beginStartFlyRewind();
            }
            return true;
        }

        this._startFlyTransitionActive = true;
        this._startFlyForWisdomRunFly = true;
        this._startFlyTransitionTarget = enterRunFly;
        this._startFlyRewinding = false;
        this._flapState = null;
        this._wisdomRunFlyAnimActive = false;
        /* enterRunFly: StartFly назад (как полёт→бег); exit: StartFly вперёд (как бег→полёт). */
        this._playStartFlyTransition(enterRunFly);
        return true;
    }

    /** Если на беге случайно FediaRunFly — вернуть FediaRun. */
    private _syncWisdomRunFlyClip(): void {
        if (
            !this._surfaceRunActive ||
            this._startFlyTransitionActive ||
            this._deathSequenceActive ||
            GameManager.game?.isPlaying !== true ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0
        ) {
            return;
        }

        const runClip = this.surfaceRunClip;
        if (
            runClip?.name &&
            this._activeSurfaceRunClip === this.surfaceRunClipFly
        ) {
            this._activeSurfaceRunClip = runClip;
            this._playSurfaceRunClip(runClip);
        }
    }

    private _stopAllSurfaceRunClips(): void {
        for (const clip of this._surfaceRunVariants) {
            this._stopClipIfPlaying(clip);
        }
        this._stopClipIfPlaying(this.surfaceRunClip);
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
        const st = this._anim.getState(name);
        if (st?.isPlaying) {
            this._applyStayState(st);
            return;
        }
        this._anim.play(name);
        const playing = this._anim.getState(name);
        if (!playing) {
            return;
        }
        this._applyStayState(playing);
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
            this._wisdomRunFlyAnimActive ||
            !this._feetOnSurface ||
            this._surfaceRunActive ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0
        ) {
            return;
        }
        this._playSurfaceStayLoop();
    }

    /** После StartFly — RunFly loop или обычный FediaFly. */
    private _resumeWisdomOrFlapPlayback(fromSurfaceEnd = false): void {
        if (this._wisdomRunFlyAnimActive && !this._surfaceRunActive) {
            this._playWisdomRunFlyLoop(fromSurfaceEnd);
            return;
        }
        this._stopClipIfPlaying(this.startFlyClip);
        this._resumeFlapPlayback(fromSurfaceEnd);
    }

    private _wisdomRunFlyPlaybackSpeed(): number {
        const clip = this.surfaceRunClipFly;
        const base = clip && clip.speed > 0 ? clip.speed : 1;
        return base * this._surfaceRunMilestoneSpeedFactor();
    }

    private _playWisdomRunFlyLoop(fromSurfaceEnd = false): void {
        const clip = this.surfaceRunClipFly;
        if (!clip?.name || !this._anim) {
            return;
        }
        this._stopClipIfPlaying(this.startFlyClip);
        this._stopClipIfPlaying(this.stayClip);
        this._stopClipIfPlaying(this.flapClip);
        this._stopAllSurfaceRunClips();
        this._ensureClipOnAnimator(clip);
        this._anim.stop();
        this._anim.play(clip.name);
        this._flapState = this._anim.getState(clip.name);
        if (!this._flapState) {
            return;
        }
        this._flapState.wrapMode = AnimationClip.WrapMode.Loop;
        this._tailTimeLeft = 0;
        if (fromSurfaceEnd) {
            this._wasHeld = false;
        }
        const speed = this._wisdomRunFlyPlaybackSpeed();
        this._flapSpeed = speed;
        this._applyFlapSpeed(speed);
    }

    /** RunFly — постоянный loop по скорости бега; flap-inertia его не гасит. */
    private _syncWisdomRunFlyPlayback(): void {
        if (
            !this._wisdomRunFlyAnimActive ||
            this._surfaceRunActive ||
            this._startFlyTransitionActive ||
            this._deathSequenceActive ||
            GameManager.game?.isPlaying !== true ||
            this._wallHitOverlayRemain > 0 ||
            this._electricOverlayRemain > 0 ||
            !this.surfaceRunClipFly?.name ||
            !this._anim
        ) {
            return;
        }

        const clip = this.surfaceRunClipFly!;
        const st = this._anim.getState(clip.name);
        const speed = this._wisdomRunFlyPlaybackSpeed();
        if (!st || !st.isPlaying || st.speed <= 1e-5) {
            this._playWisdomRunFlyLoop(true);
            return;
        }
        if (this._flapState !== st) {
            this._flapState = st;
        }
        if (Math.abs(st.speed - speed) > 1e-4 || Math.abs(this._flapSpeed - speed) > 1e-4) {
            this._flapSpeed = speed;
            this._applyFlapSpeed(speed);
        }
    }

    /**
     * @param toSurface true — полёт→бег (к t=0); false — бег/стойка→полёт (к t=конец).
     */
    private _playStartFlyTransition(toSurface: boolean): void {
        const clip = this.startFlyClip!;
        const anim = this._anim!;
        this._ensureClipOnAnimator(clip);
        this.unschedule(this._onStartFlyTransitionEnd);

        const name = clip.name;
        this._stopAllSurfaceRunClips();
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
        this._startFlyClipLen = clipLen;
        this._startFlyPlaySpeed = baseSpeed;
        this._startFlyOriginGrounded = !toSurface;

        st.wrapMode = AnimationClip.WrapMode.Normal;
        st.repeatCount = 1;
        st.speed = 0;

        if (toSurface) {
            this._startFlyManualTime = clipLen;
            this._startFlyPlaybackSign = -1;
        } else {
            this._startFlyManualTime = 0;
            this._startFlyPlaybackSign = 1;
        }
        st.time = this._startFlyManualTime;
        st.sample();
        st.pause();

        this._scheduleStartFlyEndFallback();
    }

    private _scheduleStartFlyEndFallback(): void {
        const dist = this._startFlyRewinding
            ? this._startFlyOriginGrounded
                ? this._startFlyManualTime
                : this._startFlyClipLen - this._startFlyManualTime
            : this._startFlyOriginGrounded
              ? this._startFlyClipLen - this._startFlyManualTime
              : this._startFlyManualTime;
        const duration = Math.max(
            0.05,
            dist / Math.max(this._startFlyPlaySpeed, 1e-5),
        );
        this.scheduleOnce(this._onStartFlyTransitionEnd, duration + 0.06);
    }

    /** Прервали переход — откатываем клип к исходной позе (земля или воздух). */
    private _beginStartFlyRewind(): void {
        if (this._startFlyRewinding) {
            return;
        }
        this._startFlyRewinding = true;
        this._startFlyPlaybackSign = this._startFlyOriginGrounded ? -1 : 1;
        this.unschedule(this._onStartFlyTransitionEnd);
        this._scheduleStartFlyEndFallback();
    }

    private _tickStartFlyTransition(dt: number): void {
        if (
            !this._startFlyTransitionActive ||
            !this._anim ||
            !this.startFlyClip?.name
        ) {
            return;
        }
        const st = this._anim.getState(this.startFlyClip.name);
        if (!st) {
            if (this._startFlyRewinding) {
                this._completeStartFlyRewind();
            } else {
                this._finishStartFlyTransition();
            }
            return;
        }

        const len = this._startFlyClipLen;
        this._startFlyManualTime +=
            this._startFlyPlaybackSign * dt * this._startFlyPlaySpeed;

        if (this._startFlyRewinding) {
            if (this._startFlyOriginGrounded) {
                if (this._startFlyManualTime <= 0) {
                    this._startFlyManualTime = 0;
                    st.time = 0;
                    st.sample();
                    this._completeStartFlyRewind();
                    return;
                }
            } else if (this._startFlyManualTime >= len) {
                this._startFlyManualTime = len;
                st.time = len;
                st.sample();
                this._completeStartFlyRewind();
                return;
            }
        } else if (this._startFlyOriginGrounded) {
            if (this._startFlyManualTime >= len) {
                this._startFlyManualTime = len;
                st.time = len;
                st.sample();
                this._finishStartFlyTransition();
                return;
            }
        } else if (this._startFlyManualTime <= 0) {
            this._startFlyManualTime = 0;
            st.time = 0;
            st.sample();
            this._finishStartFlyTransition();
            return;
        }

        st.time = Math.min(len, Math.max(0, this._startFlyManualTime));
        st.sample();
    }

    private _finishStartFlyTransition(): void {
        if (!this._startFlyTransitionActive || this._startFlyRewinding) {
            return;
        }
        this.unschedule(this._onStartFlyTransitionEnd);
        this._startFlyTransitionActive = false;
        this._startFlyRewinding = false;

        if (this._startFlyForWisdomRunFly) {
            this._startFlyForWisdomRunFly = false;
            this._wisdomRunFlyAnimActive = this._startFlyTransitionTarget;
            this._lastWisdomRunFlyForced = this._wisdomRunFlyAnimActive;
            this._resumeWisdomOrFlapPlayback(true);
            return;
        }

        const target = this._startFlyTransitionTarget;
        if (!target) {
            this._feetOnSurface = false;
        }
        this._applyRunningOnSurface(target);
    }

    private _completeStartFlyRewind(): void {
        if (!this._startFlyTransitionActive) {
            return;
        }
        this.unschedule(this._onStartFlyTransitionEnd);
        this._startFlyTransitionActive = false;
        this._startFlyRewinding = false;
        this._runStartTakeoffPending = false;

        if (this._startFlyForWisdomRunFly) {
            this._startFlyForWisdomRunFly = false;
            if (this._startFlyOriginGrounded) {
                this._wisdomRunFlyAnimActive = true;
            } else {
                this._wisdomRunFlyAnimActive = false;
            }
            this._lastWisdomRunFlyForced = this._wisdomRunFlyAnimActive;
            this._feetOnSurface = false;
            this._resumeWisdomOrFlapPlayback(true);
            return;
        }

        if (this._startFlyOriginGrounded) {
            this._feetOnSurface = true;
            this._applyRunningOnSurface(true);
        } else {
            this._feetOnSurface = false;
            this._applyRunningOnSurface(false);
        }
    }

    private _cancelStartFlyTransition(): void {
        if (!this._startFlyTransitionActive) {
            this._startFlyForWisdomRunFly = false;
            return;
        }
        const resumeRunOnSurface = this._feetOnSurface && !this._surfaceRunActive;
        this.unschedule(this._onStartFlyTransitionEnd);
        this._startFlyTransitionActive = false;
        this._startFlyRewinding = false;
        this._runStartTakeoffPending = false;
        this._flapState = null;
        if (this._startFlyForWisdomRunFly) {
            this._startFlyForWisdomRunFly = false;
            this._wisdomRunFlyAnimActive = false;
            this._lastWisdomRunFlyForced = false;
            this._resumeFlapPlayback(true);
            return;
        }
        if (resumeRunOnSurface) {
            this._applyRunningOnSurface(true);
        }
    }

    protected override _onBeforeResumeSurfaceRun(): void {
        this._stopClipIfPlaying(this.startFlyClip);
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
        this._tickStartFlyTransition(dt);
        this._tryRunStartTakeoffTransition();
        this._syncWisdomRunFlyTransition();
        this._syncFeetOnSurfaceStay();
        super.update(dt);
        this._syncWisdomRunFlyClip();
        this._syncWisdomRunFlyPlayback();
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

    /** hp_Icon на корне Player — та же логика, что у Pigeon (клип + полёт к UI). */
    public override playHpHarvest(
        targetWorldPos: Vec3,
        slotIndex: number,
        onComplete: () => void,
    ): boolean {
        return super.playHpHarvest(targetWorldPos, slotIndex, onComplete);
    }
}
