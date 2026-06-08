import {
    _decorator,
    Animation,
    AnimationClip,
    AudioSource,
    Button,
    Canvas,
    Component,
    game,
    Label,
    Node,
    tween,
    Tween,
    Vec3,
} from 'cc';
import { CameraShake } from './CameraShake';
import { GameSession } from './GameSession';

const { ccclass, property, executionOrder } = _decorator;

const G_INTRO = { id: 'Intro', name: 'First launch intro' };
const G_CAM = { id: 'Camera', name: 'Camera pan' };

/**
 * Заставка на корне Chunk_Start: typewriter → Skip → ChangeToStart → StartGameBttn → StartRemove → панорама.
 * Ссылки на UI, Animation и Audio — только через инспектор.
 */
@ccclass('GameIntroController')
@executionOrder(-100)
export class GameIntroController extends Component {
    private static _inst: GameIntroController | null = null;

    public static get instance(): GameIntroController | null {
        return GameIntroController._inst;
    }

    @property({
        group: G_CAM,
        type: Node,
        displayName: 'Camera Node',
        tooltip: 'Пусто — камера с Canvas.',
    })
    cameraNode: Node | null = null;

    @property({
        group: G_CAM,
        displayName: 'Intro Position',
        tooltip: 'Позиция камеры на заставке (первый запуск).',
    })
    introPosition = new Vec3(-2116.027, 0, 1000);

    @property({
        group: G_CAM,
        displayName: 'Gameplay Position',
        tooltip: 'Позиция камеры в игре (обычно 0, 0, z камеры).',
    })
    gameplayPosition = new Vec3(0, 0, 1000);

    @property({
        group: G_CAM,
        displayName: 'Pan Duration (s)',
        tooltip: 'Длительность переезда камеры к игровому полю после заставки.',
    })
    panDuration = 1.35;

    @property({
        group: G_CAM,
        displayName: 'Pan Easing',
        tooltip: 'Easing для tween камеры (например sineInOut, quadOut).',
    })
    panEasing = 'sineInOut';

    @property({
        group: G_INTRO,
        type: Animation,
        displayName: 'Intro Animation',
        tooltip:
            'Опционально: Animation на заставке (Chunk_Start / UI). По FINISHED — панорама камеры.',
    })
    introAnimation: Animation | null = null;

    @property({
        group: G_INTRO,
        type: AnimationClip,
        displayName: 'Intro Clip',
        tooltip: 'Клип Intro Animation. Пусто — defaultClip на Intro Animation.',
    })
    introClip: AnimationClip | null = null;

    @property({
        group: G_INTRO,
        displayName: 'Intro Wait (s)',
        tooltip:
            'Если Intro Animation не задан — пауза перед панорамой. Если задан — доп. пауза после клипа.',
    })
    introWaitSec = 0.5;

    @property({
        group: G_INTRO,
        type: Label,
        displayName: 'Label Board',
        tooltip: 'LabelBoard на IntroBoard.',
    })
    labelBoard: Label | null = null;

    @property({
        group: G_INTRO,
        type: Animation,
        displayName: 'Intro Board Animation',
        tooltip: 'Animation на IntroBoard (SkipTextScroll).',
    })
    introBoardAnimation: Animation | null = null;

    @property({
        group: G_INTRO,
        type: Button,
        displayName: 'Skip Button',
        tooltip: 'SkipBttn — допечатка и ChangeToStart.',
    })
    skipButton: Button | null = null;

    @property({
        group: G_INTRO,
        type: Button,
        displayName: 'Start Game Button',
        tooltip: 'StartGameBttn — StartRemove, затем панорама.',
    })
    startGameButton: Button | null = null;

    @property({
        group: G_INTRO,
        type: Animation,
        displayName: 'Buttons Container Animation',
        tooltip: 'Animation на контейнере кнопок (ChangeToStart).',
    })
    introButtonsAnimation: Animation | null = null;

    @property({
        group: G_INTRO,
        displayName: 'Typewriter Char Interval (s)',
        tooltip: 'Пауза между символами на заставке.',
    })
    typewriterCharIntervalSec = 0.045;

    @property({
        group: G_INTRO,
        type: AnimationClip,
        displayName: 'Skip Text Scroll Clip',
        tooltip: 'Клип на Intro Board Animation после окончания печати.',
    })
    skipTextScrollClip: AnimationClip | null = null;

    @property({
        group: G_INTRO,
        type: AnimationClip,
        displayName: 'Change To Start Clip',
        tooltip: 'Клип на Buttons Container Animation после допечатки.',
    })
    changeToStartClip: AnimationClip | null = null;

    @property({
        group: G_INTRO,
        type: AnimationClip,
        displayName: 'Start Remove Clip',
        tooltip: 'Клип на Buttons Container Animation после StartGameBttn.',
    })
    startRemoveClip: AnimationClip | null = null;

    @property({
        group: G_INTRO,
        type: AudioSource,
        displayName: 'Intro Board Audio',
        tooltip: 'AudioSource на IntroBoard (озвучка typewriter).',
    })
    introBoardAudio: AudioSource | null = null;

    @property({
        group: G_INTRO,
        displayName: 'Intro Board Fade Out (s)',
        tooltip: 'Плавное затухание озвучки при Skip или конце печати. 0 — резкий stop.',
    })
    introBoardAudioFadeSec = 0.35;

    @property({
        group: G_INTRO,
        type: AudioSource,
        displayName: 'Crowd Loop Audio',
        tooltip: 'AudioSource на CrowdSpawner (loop).',
    })
    crowdLoopAudio: AudioSource | null = null;

    private _blockingInput = false;
    /** Ждём StartGameBttn для панорамы (после ChangeToStart). */
    private _awaitingUserTap = false;
    private _running = false;
    private _label: Label | null = null;
    private _fullLabelText = '';
    private _typewriterCharIndex = 0;
    private _typewriterDone = false;
    private _postTextAnimStarted = false;
    private _buttonsReadyForStart = false;
    private _panTween: Tween<Node> | null = null;
    private _introBoardFadeRemainSec = 0;
    private _introBoardRestVolume = 1;
    private _crowdLoopActive = false;
    private readonly _gameplayRest = new Vec3();

    /** Wing-flap на PFall* — только пока играет loop CrowdSpawner (ожидание первого тапа). */
    public static isCrowdWingFlapEnabled(): boolean {
        return GameIntroController._inst?._crowdLoopActive === true;
    }

    /** Блокировать старт забега: ожидание клика для заставки и во время панорамы. */
    public get isBlockingInput(): boolean {
        return this._blockingInput;
    }

    /** SkipBttn: допечатать текст и запустить SkipTextScroll → ChangeToStart. */
    public handleSkipButtonClick(): boolean {
        if (!this._shouldPlayIntro() || this._running) {
            return false;
        }
        if (this._buttonsReadyForStart || this._postTextAnimStarted) {
            return true;
        }

        if (!this._typewriterDone) {
            this._completeTypewriterInstant();
        } else {
            this._playPostTextAnimations();
        }
        return true;
    }

    /** StartGameBttn: StartRemove → панорама камеры (после ChangeToStart). */
    public handleStartGameButtonClick(): boolean {
        if (!this._shouldPlayIntro() || this._running) {
            return false;
        }
        if (!this._buttonsReadyForStart || !this._awaitingUserTap) {
            return false;
        }

        this._awaitingUserTap = false;
        if (this.startGameButton?.isValid) {
            this.startGameButton.interactable = false;
        }
        this._playStartRemoveThen(() => this._runIntroSequence());
        return true;
    }

    /** Вызвать из GameManager.returnToTapToStart — снять блок ввода (камеру ставит новый Chunk_Start). */
    public static skipIntroAfterRestart(): void {
        GameIntroController._inst?._clearIntroBlockingState();
    }

    /** После Play Again заставка не должна блокировать тап по экрану. */
    private _clearIntroBlockingState(): void {
        this._blockingInput = false;
        this._awaitingUserTap = false;
        this._running = false;
        this._postTextAnimStarted = false;
        this._buttonsReadyForStart = false;
        this._stopTypewriter();
        this._stopPanTween();
        this._stopIntroBoardAudio(true);
        this._crowdLoopActive = false;
    }

    /** Остановить loop Crowd при старте забега (GameManager.startNewRun). */
    public stopAwaitingFlyAudio(): void {
        this._stopCrowdLoop();
    }

    onLoad() {
        GameIntroController._inst = this;
        this._bindIntroButtons();

        const cam = this._resolveCamera();
        if (cam) {
            this.gameplayPosition.z = cam.position.z;
        }
        this._gameplayRest.set(this.gameplayPosition);

        if (this._shouldPlayIntro()) {
            this._blockingInput = true;
            this._awaitingUserTap = false;
            this._ensureIntroCamera(0);
            console.log(
                '[GameIntroController] Заставка: typewriter → Skip → ChangeToStart → StartGameBttn → StartRemove → панорама.',
            );
        } else {
            this.snapToGameplayCamera();
            this._stopIntroBoardAudio(true);
            this._startCrowdLoop();
        }
    }

    start() {
        this._bindIntroButtons();
        if (!this._shouldPlayIntro()) {
            this._stopIntroBoardAudio(true);
            this._startCrowdLoop();
            return;
        }
        this._ensureIntroCamera(0);
        this._tryStartIntroContent(0);
    }

    onDestroy() {
        this._unbindIntroButtons();
        this._stopTypewriter();
        this._stopPanTween();
        this._stopIntroBoardAudio(true);
        this._stopCrowdLoop();
        if (GameIntroController._inst === this) {
            GameIntroController._inst = null;
        }
    }

    /** Камера на игровую позицию (после рестарта или если заставка пропущена). */
    public snapToGameplayCamera(): void {
        const cam = this._resolveCamera();
        if (!cam?.isValid) {
            return;
        }
        this._stopPanTween();
        cam.setPosition(this.gameplayPosition);
        this._syncCameraShakeRest();
    }

    private _shouldPlayIntro(): boolean {
        return !(GameSession.game?.isAwaitingFirstTapToRun ?? false);
    }

    /** Камера/Canvas иногда ещё не готовы в onLoad чанка (редактор) — несколько попыток. */
    private _ensureIntroCamera(attempt: number): void {
        if (!this._shouldPlayIntro()) {
            return;
        }
        const cam = this._resolveCamera();
        if (cam?.isValid) {
            this._applyIntroCamera(cam);
            return;
        }
        if (attempt >= 40) {
            console.warn(
                '[GameIntroController] Камера не найдена — intro-позиция не применена.',
            );
            return;
        }
        this.scheduleOnce(() => this._ensureIntroCamera(attempt + 1), 0.05);
    }

    private _onSkipButtonClick(): void {
        GameSession.game?.shakeMenuButton();
        this.handleSkipButtonClick();
    }

    private _onStartGameButtonClick(): void {
        GameSession.game?.shakeMenuButton();
        this.handleStartGameButtonClick();
    }

    private _bindIntroButtons(): void {
        this._unbindIntroButtons();
        if (this.skipButton?.isValid) {
            this.skipButton.node.on(
                Button.EventType.CLICK,
                this._onSkipButtonClick,
                this,
            );
            GameSession.game?.bindMenuButtonPressFeedback(this.skipButton);
        }
        if (this.startGameButton?.isValid) {
            this.startGameButton.node.on(
                Button.EventType.CLICK,
                this._onStartGameButtonClick,
                this,
            );
            GameSession.game?.bindMenuButtonPressFeedback(this.startGameButton);
        }
    }

    private _unbindIntroButtons(): void {
        if (this.skipButton?.node?.isValid) {
            this.skipButton.node.off(
                Button.EventType.CLICK,
                this._onSkipButtonClick,
                this,
            );
            GameSession.game?.unbindMenuButtonPressFeedback(this.skipButton.node);
        }
        if (this.startGameButton?.node?.isValid) {
            this.startGameButton.node.off(
                Button.EventType.CLICK,
                this._onStartGameButtonClick,
                this,
            );
            GameSession.game?.unbindMenuButtonPressFeedback(
                this.startGameButton.node,
            );
        }
    }

    private _tryStartIntroContent(attempt: number): void {
        if (!this._shouldPlayIntro() || this._running) {
            return;
        }

        this._initIntroButtonsState();

        const label = this.labelBoard?.isValid ? this.labelBoard : null;
        if (label) {
            this._label = label;
            this._fullLabelText = label.string;
            this._typewriterCharIndex = 0;
            this._typewriterDone = false;
            this._postTextAnimStarted = false;
            this._buttonsReadyForStart = false;
            label.string = '';
            const interval = Math.max(0.01, this.typewriterCharIntervalSec);
            this._startIntroBoardAudio();
            this.schedule(this._tickTypewriter, interval);
            return;
        }

        if (attempt < 60) {
            this.scheduleOnce(() => this._tryStartIntroContent(attempt + 1), 0.1);
            return;
        }

        console.warn(
            '[GameIntroController] Label Board не задан в инспекторе — клик сразу запускает панораму.',
        );
        this._typewriterDone = true;
    }

    private _initIntroButtonsState(): void {
        if (this.skipButton?.isValid) {
            this.skipButton.interactable = true;
        }
        if (this.startGameButton?.isValid) {
            this.startGameButton.interactable = false;
        }
    }

    private _tickTypewriter(): void {
        if (!this._label?.isValid) {
            this._stopTypewriter();
            return;
        }

        this._typewriterCharIndex += 1;
        this._label.string = this._fullLabelText.slice(0, this._typewriterCharIndex);

        if (this._typewriterCharIndex >= this._fullLabelText.length) {
            this._finishTypewriter();
        }
    }

    private _completeTypewriterInstant(): void {
        if (!this._label?.isValid) {
            this._finishTypewriter();
            return;
        }

        this._stopTypewriter();
        this._label.string = this._fullLabelText;
        this._typewriterCharIndex = this._fullLabelText.length;
        this._finishTypewriter();
    }

    /** Текст допечатан (сам или Skip) → SkipTextScroll → ChangeToStart. */
    private _finishTypewriter(): void {
        if (this._typewriterDone) {
            return;
        }
        this._stopTypewriter();
        this._stopIntroBoardAudio(false);
        this._typewriterDone = true;
        this._playPostTextAnimations();
    }

    private _playPostTextAnimations(): void {
        if (this._postTextAnimStarted) {
            return;
        }
        this._stopIntroBoardAudio(false);
        this._postTextAnimStarted = true;
        if (this.skipButton?.isValid) {
            this.skipButton.interactable = false;
        }
        this._playClipThen(this.introBoardAnimation, this.skipTextScrollClip, () =>
            this._playChangeToStart(),
        );
    }

    private _playStartRemoveThen(onDone: () => void): void {
        const anim = this.introButtonsAnimation;
        if (!anim?.isValid) {
            console.warn(
                '[GameIntroController] Buttons Container Animation не задан — сразу панорама.',
            );
            onDone();
            return;
        }

        if (!this.startRemoveClip?.name) {
            console.warn(
                '[GameIntroController] Start Remove Clip не задан — сразу панорама.',
            );
            onDone();
            return;
        }
        this._playClipThen(anim, this.startRemoveClip, onDone);
    }

    private _playChangeToStart(): void {
        const anim = this.introButtonsAnimation;
        if (!anim?.isValid) {
            console.warn(
                '[GameIntroController] Buttons Container Animation не задан.',
            );
            this._onButtonsReady();
            return;
        }

        if (!this.changeToStartClip?.name) {
            console.warn(
                '[GameIntroController] Change To Start Clip не задан.',
            );
            this._onButtonsReady();
            return;
        }
        this._playClipThen(anim, this.changeToStartClip, () => this._onButtonsReady());
    }

    private _onButtonsReady(): void {
        this._buttonsReadyForStart = true;
        this._awaitingUserTap = true;
        if (this.skipButton?.isValid) {
            this.skipButton.interactable = false;
        }
        if (this.startGameButton?.isValid) {
            this.startGameButton.interactable = true;
        }
    }

    private _playClipThen(
        anim: Animation | null,
        clip: AnimationClip | null,
        onDone: () => void,
    ): void {
        if (!anim?.isValid || !clip?.name) {
            onDone();
            return;
        }

        this._ensureClipOnAnim(anim, clip);

        const name = clip.name;
        let done = false;
        const finish = () => {
            if (done) {
                return;
            }
            done = true;
            anim.off(Animation.EventType.FINISHED, onFinished, this);
            this.unschedule(finish);
            onDone();
        };

        const onFinished = (_type: string, state: { name?: string } | null) => {
            if (state?.name && state.name !== name) {
                return;
            }
            finish();
        };

        anim.off(Animation.EventType.FINISHED, onFinished, this);
        anim.on(Animation.EventType.FINISHED, onFinished, this);
        anim.stop();
        anim.play(name);

        const speed =
            anim.getState(name)?.speed ??
            clip.speed ??
            1;
        const wait = Math.max(
            0.08,
            (clip.duration ?? 0.35) / Math.max(0.01, Math.abs(speed)) + 0.06,
        );
        this.scheduleOnce(finish, wait);
    }

    private _ensureClipOnAnim(anim: Animation, clip: AnimationClip): void {
        if (anim.clips.indexOf(clip) < 0) {
            anim.addClip(clip);
        }
    }

    private _stopTypewriter(): void {
        this.unschedule(this._tickTypewriter);
    }

    private _applyIntroCamera(cam: Node | null): void {
        if (!cam?.isValid) {
            return;
        }
        cam.setPosition(this.introPosition);
        cam.getComponent(CameraShake)?.setRestAnchor(this.introPosition);
    }

    private _runIntroSequence(): void {
        if (this._running) {
            return;
        }
        this._running = true;
        this._blockingInput = true;

        const afterIntroContent = () => {
            const wait = Math.max(0, this.introWaitSec);
            if (wait > 0) {
                this.scheduleOnce(() => this._panCameraToGameplay(), wait);
            } else {
                this._panCameraToGameplay();
            }
        };

        if (this.introAnimation) {
            this._playIntroAnimation(afterIntroContent);
        } else {
            afterIntroContent();
        }
    }

    private _playIntroAnimation(onDone: () => void): void {
        const anim = this.introAnimation!;
        const clip =
            this.introClip ??
            anim.defaultClip ??
            anim.clips[0] ??
            null;
        if (!clip?.name) {
            console.warn(
                '[GameIntroController] Intro Clip не задан — только introWaitSec.',
            );
            onDone();
            return;
        }

        this._ensureClipOnAnim(anim, clip);

        const onFinished = () => {
            anim.off(Animation.EventType.FINISHED, onFinished, this);
            onDone();
        };
        anim.on(Animation.EventType.FINISHED, onFinished, this);
        anim.play(clip.name);
    }

    private _panCameraToGameplay(): void {
        const cam = this._resolveCamera();
        if (!cam?.isValid) {
            this._finishIntro();
            return;
        }

        const duration = Math.max(0.01, this.panDuration);
        if (duration <= 0.02) {
            cam.setPosition(this.gameplayPosition);
            this._finishIntro();
            return;
        }

        this._stopPanTween();
        this._panTween = tween(cam)
            .to(
                duration,
                {
                    position: new Vec3(
                        this.gameplayPosition.x,
                        this.gameplayPosition.y,
                        this.gameplayPosition.z,
                    ),
                },
                { easing: this.panEasing as 'sineInOut' },
            )
            .call(() => {
                this._panTween = null;
                this._finishIntro();
            });
        this._panTween.start();
    }

    private _finishIntro(): void {
        this.snapToGameplayCamera();
        this._blockingInput = false;
        this._running = false;
        this._startCrowdLoop();
    }

    private _cancelIntroBoardFadeTween(): void {
        this._introBoardFadeRemainSec = 0;
        this.unschedule(this._tickIntroBoardFadeOut);
        const audio = this._resolveIntroBoardAudio();
        if (audio?.isValid) {
            Tween.stopAllByTarget(audio);
        }
    }

    private _resolveIntroBoardAudio(): AudioSource | null {
        if (this.introBoardAudio?.isValid) {
            return this.introBoardAudio;
        }
        const anim = this.introBoardAnimation;
        if (anim?.isValid) {
            const src = anim.node.getComponent(AudioSource);
            if (src) {
                this.introBoardAudio = src;
                return src;
            }
        }
        return null;
    }

    private readonly _tickIntroBoardFadeOut = (): void => {
        const audio = this._resolveIntroBoardAudio();
        if (!audio?.isValid) {
            this._cancelIntroBoardFadeTween();
            return;
        }

        const fadeSec = Math.max(0.01, this.introBoardAudioFadeSec);
        const dt = Math.max(1e-6, game.deltaTime);
        this._introBoardFadeRemainSec = Math.max(
            0,
            this._introBoardFadeRemainSec - dt,
        );
        const k = this._introBoardFadeRemainSec / fadeSec;
        audio.volume = this._introBoardRestVolume * k;

        if (this._introBoardFadeRemainSec <= 0) {
            this._cancelIntroBoardFadeTween();
            audio.stop();
            audio.volume = this._introBoardRestVolume;
        }
    };

    private _stopIntroBoardAudio(instant: boolean): void {
        const audio = this._resolveIntroBoardAudio();
        if (!audio?.isValid) {
            this._cancelIntroBoardFadeTween();
            return;
        }

        this._cancelIntroBoardFadeTween();

        const fadeSec = instant ? 0 : Math.max(0, this.introBoardAudioFadeSec);
        if (fadeSec <= 0) {
            audio.stop();
            audio.volume = this._introBoardRestVolume;
            return;
        }

        this._introBoardRestVolume =
            audio.volume > 0 ? audio.volume : this._introBoardRestVolume;
        this._introBoardFadeRemainSec = fadeSec;
        audio.volume = this._introBoardRestVolume;
        this.schedule(this._tickIntroBoardFadeOut, 0);
    }

    /** Старт озвучки typewriter (AudioSource на IntroBoard). */
    private _startIntroBoardAudio(): void {
        const audio = this._resolveIntroBoardAudio();
        if (!audio?.isValid || !audio.clip) {
            return;
        }

        this._cancelIntroBoardFadeTween();
        this._introBoardRestVolume = audio.volume > 0 ? audio.volume : 1;
        audio.volume = this._introBoardRestVolume;
        audio.loop = false;
        audio.stop();
        audio.play();
    }

    private _startCrowdLoop(): void {
        const audio = this.crowdLoopAudio;
        if (!audio?.isValid || !audio.clip) {
            this._crowdLoopActive = false;
            return;
        }
        audio.loop = true;
        if (!audio.playing) {
            audio.play();
        }
        this._crowdLoopActive = audio.playing;
    }

    private _stopCrowdLoop(): void {
        this._crowdLoopActive = false;
        const audio = this.crowdLoopAudio;
        if (!audio?.isValid) {
            return;
        }
        audio.stop();
    }

    private _syncCameraShakeRest(): void {
        const cam = this._resolveCamera();
        if (!cam) {
            return;
        }
        this._gameplayRest.set(this.gameplayPosition);
        cam.getComponent(CameraShake)?.setRestPosition(this._gameplayRest);
    }

    private _resolveCamera(): Node | null {
        if (this.cameraNode?.isValid) {
            return this.cameraNode;
        }
        let cur: Node | null = this.node;
        while (cur) {
            const canvas = cur.getComponent(Canvas);
            const cam = canvas?.cameraComponent?.node;
            if (cam?.isValid) {
                return cam;
            }
            cur = cur.parent;
        }
        return null;
    }

    private _stopPanTween(): void {
        const cam = this._resolveCamera();
        if (this._panTween) {
            this._panTween.stop();
            this._panTween = null;
        } else if (cam) {
            Tween.stopAllByTarget(cam);
        }
    }
}
