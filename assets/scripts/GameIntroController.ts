import {
    _decorator,
    Animation,
    AnimationClip,
    Button,
    Canvas,
    Component,
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
 * Заставка на корне Chunk_Start: typewriter → Skip → ChangeToStart → StartGameBttn → панорама.
 * Кнопки и Animation — ссылки в инспекторе на этом же префабе (не на Canvas).
 */
@ccclass('GameIntroController')
@executionOrder(-100)
export class GameIntroController extends Component {
    private static _inst: GameIntroController | null = null;

    /** После Play Again — static: Chunk_Start пересоздаётся, инстанс новый. */
    private static _skipIntroAfterRestart = false;

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
        displayName: 'Intro Clip Name',
        tooltip: 'Имя клипа, если на Animation несколько. Пусто — defaultClip.',
    })
    introClipName = '';

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
        tooltip: 'LabelBoard в Chunk_Start. Пусто — поиск по имени в дочерних нодах.',
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
        tooltip: 'StartGameBttn — панорама после ChangeToStart.',
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
        displayName: 'Label Board Name (fallback)',
        tooltip: 'Если Label Board не задан — поиск по имени.',
    })
    labelBoardNodeName = 'LabelBoard';

    @property({
        group: G_INTRO,
        displayName: 'Typewriter Char Interval (s)',
        tooltip: 'Пауза между символами на заставке.',
    })
    typewriterCharIntervalSec = 0.045;

    @property({
        group: G_INTRO,
        displayName: 'Intro Board Name',
        tooltip:
            'Нода IntroBoard в Chunk_Start: после допечатки текста проигрывается SkipTextScroll.',
    })
    introBoardNodeName = 'IntroBoard';

    @property({
        group: G_INTRO,
        displayName: 'Skip Text Scroll Clip',
        tooltip: 'Клип Animation на IntroBoard после окончания печати.',
    })
    skipTextScrollClipName = 'SkipTextScroll';

    @property({
        group: G_INTRO,
        displayName: 'Intro Buttons Container',
        tooltip:
            'Родитель SkipBttn / StartGameBttn с Animation (ChangeToStart). Пусто — родитель SkipBttn.',
    })
    introButtonsContainerName = '';

    @property({
        group: G_INTRO,
        displayName: 'Change To Start Clip',
        tooltip: 'Клип на контейнере кнопок после допечатки (ChanfeToStart — опечатка в ассете).',
    })
    changeToStartClipName = 'ChangeToStart';

    @property({
        group: G_INTRO,
        displayName: 'Skip Button Name',
        tooltip: 'SkipBttn на Chunk_Start.',
    })
    skipButtonNodeName = 'SkipBttn';

    @property({
        group: G_INTRO,
        displayName: 'Start Game Button Name',
        tooltip: 'StartGameBttn — панорама камеры после ChangeToStart.',
    })
    startGameButtonNodeName = 'StartGameBttn';

    private _blockingInput = false;
    /** Ждём StartGameBttn для панорамы (после ChangeToStart). */
    private _awaitingUserTap = false;
    private _running = false;
    private _label: Label | null = null;
    private _introBoardAnim: Animation | null = null;
    private _introButtonsAnim: Animation | null = null;
    private _fullLabelText = '';
    private _typewriterCharIndex = 0;
    private _typewriterDone = false;
    private _postTextAnimStarted = false;
    private _buttonsReadyForStart = false;
    private _panTween: Tween<Node> | null = null;
    private readonly _gameplayRest = new Vec3();

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

    /** StartGameBttn: панорама камеры (после ChangeToStart). */
    public handleStartGameButtonClick(): boolean {
        if (!this._shouldPlayIntro() || this._running) {
            return false;
        }
        if (!this._buttonsReadyForStart || !this._awaitingUserTap) {
            return false;
        }

        this._awaitingUserTap = false;
        this._runIntroSequence();
        return true;
    }

    /** Вызвать из GameManager.returnToTapToStart — не показывать заставку до перезагрузки сцены. */
    public static skipIntroAfterRestart(): void {
        GameIntroController._skipIntroAfterRestart = true;
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
    }

    onLoad() {
        GameIntroController._inst = this;
        this._resolveChunkRefs();
        this._bindIntroButtons();

        const cam = this._resolveCamera();
        if (cam) {
            this.gameplayPosition.z = cam.position.z;
        }
        this._gameplayRest.set(this.gameplayPosition);

        if (this._shouldPlayIntro()) {
            this._blockingInput = true;
            this._awaitingUserTap = false;
            this._applyIntroCamera(cam);
            console.log(
                '[GameIntroController] Заставка: typewriter → Skip → ChangeToStart → StartGameBttn → панорама.',
            );
            this.scheduleOnce(() => this._applyIntroCamera(this._resolveCamera()), 0);
        } else {
            this.snapToGameplayCamera();
        }
    }

    start() {
        this._resolveChunkRefs();
        this._bindIntroButtons();
        if (!this._shouldPlayIntro()) {
            return;
        }
        this._applyIntroCamera(this._resolveCamera());
        this._tryStartIntroContent(0);
    }

    onDestroy() {
        this._unbindIntroButtons();
        this._stopTypewriter();
        this._stopPanTween();
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
        return !GameIntroController._skipIntroAfterRestart;
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

    private _resolveChunkRefs(): void {
        if (!this.labelBoard?.isValid) {
            this.labelBoard =
                this._findInChunk(this.labelBoardNodeName || 'LabelBoard')?.getComponent(
                    Label,
                ) ?? null;
        }
        if (!this.introBoardAnimation?.isValid) {
            this.introBoardAnimation =
                this._findInChunk(this.introBoardNodeName || 'IntroBoard')?.getComponent(
                    Animation,
                ) ?? null;
        }
        if (!this.skipButton?.isValid) {
            this.skipButton =
                this._findInChunk(this.skipButtonNodeName || 'SkipBttn')?.getComponent(
                    Button,
                ) ?? null;
        }
        if (!this.startGameButton?.isValid) {
            this.startGameButton =
                this._findInChunk(
                    this.startGameButtonNodeName || 'StartGameBttn',
                )?.getComponent(Button) ?? null;
        }
        if (!this.introButtonsAnimation?.isValid) {
            const byName = this.introButtonsContainerName.trim();
            if (byName) {
                this.introButtonsAnimation =
                    this._findInChunk(byName)?.getComponent(Animation) ?? null;
            }
            if (!this.introButtonsAnimation?.isValid) {
                this.introButtonsAnimation =
                    this.skipButton?.node?.parent?.getComponent(Animation) ?? null;
            }
        }
        if (this.introBoardAnimation?.isValid) {
            this._introBoardAnim = this.introBoardAnimation;
        }
        if (this.introButtonsAnimation?.isValid) {
            this._introButtonsAnim = this.introButtonsAnimation;
        }
    }

    private _tryStartIntroContent(attempt: number): void {
        if (!this._shouldPlayIntro() || this._running) {
            return;
        }

        if (!this._introBoardAnim?.isValid) {
            this._introBoardAnim = this._findIntroBoardAnimation();
        }
        if (!this._introButtonsAnim?.isValid) {
            this._introButtonsAnim = this._findIntroButtonsAnimation();
        }
        this._initIntroButtonsState();

        const label = this._findLabelBoard();
        if (label) {
            this._label = label;
            this._fullLabelText = label.string;
            this._typewriterCharIndex = 0;
            this._typewriterDone = false;
            this._postTextAnimStarted = false;
            this._buttonsReadyForStart = false;
            label.string = '';
            const interval = Math.max(0.01, this.typewriterCharIntervalSec);
            this.schedule(this._tickTypewriter, interval);
            return;
        }

        if (attempt < 60) {
            this.scheduleOnce(() => this._tryStartIntroContent(attempt + 1), 0.1);
            return;
        }

        console.warn(
            `[GameIntroController] Label "${this.labelBoardNodeName}" не найден — клик сразу запускает панораму.`,
        );
        this._typewriterDone = true;
    }

    /** Поиск только внутри Chunk_Start (this.node и дети). */
    private _findInChunk(nodeName: string): Node | null {
        const targetName = nodeName.trim();
        if (!targetName || !this.node?.isValid) {
            return null;
        }
        const stack: Node[] = [this.node];
        while (stack.length > 0) {
            const node = stack.pop()!;
            if (node.name === targetName) {
                return node;
            }
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
        return null;
    }

    private _findLabelBoard(): Label | null {
        if (this.labelBoard?.isValid) {
            return this.labelBoard;
        }
        return (
            this._findInChunk(this.labelBoardNodeName || 'LabelBoard')?.getComponent(
                Label,
            ) ?? null
        );
    }

    private _findIntroBoardAnimation(): Animation | null {
        if (this.introBoardAnimation?.isValid) {
            return this.introBoardAnimation;
        }
        return (
            this._findInChunk(this.introBoardNodeName || 'IntroBoard')?.getComponent(
                Animation,
            ) ?? null
        );
    }

    private _findIntroButtonsAnimation(): Animation | null {
        if (this.introButtonsAnimation?.isValid) {
            return this.introButtonsAnimation;
        }
        const byName = this.introButtonsContainerName.trim();
        if (byName) {
            const anim = this._findInChunk(byName)?.getComponent(Animation);
            if (anim) {
                return anim;
            }
        }
        const skip =
            this.skipButton?.node ??
            this._findInChunk(this.skipButtonNodeName || 'SkipBttn');
        return skip?.parent?.getComponent(Animation) ?? null;
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
        this._typewriterDone = true;
        this._playPostTextAnimations();
    }

    private _playPostTextAnimations(): void {
        if (this._postTextAnimStarted) {
            return;
        }
        this._postTextAnimStarted = true;
        if (this.skipButton?.isValid) {
            this.skipButton.interactable = false;
        }
        this._playClipThen(
            this._introBoardAnim ?? this._findIntroBoardAnimation(),
            this.skipTextScrollClipName,
            'SkipTextScroll',
            () => this._playChangeToStart(),
        );
    }

    private _playChangeToStart(): void {
        const anim =
            this._introButtonsAnim?.isValid
                ? this._introButtonsAnim
                : this._findIntroButtonsAnimation();
        if (!anim?.isValid) {
            console.warn(
                '[GameIntroController] Контейнер кнопок / ChangeToStart не найден.',
            );
            this._onButtonsReady();
            return;
        }
        this._introButtonsAnim = anim;

        const clipName = this._resolveChangeToStartClipName(anim);
        this._playClipThen(anim, clipName, clipName, () => this._onButtonsReady());
    }

    private _resolveChangeToStartClipName(anim: Animation): string {
        const custom = this.changeToStartClipName.trim();
        const candidates = [
            custom,
            'ChangeToStart',
            'ChanfeToStart',
            anim.defaultClip?.name ?? '',
            anim.clips[0]?.name ?? '',
        ];
        for (const name of candidates) {
            if (!name) {
                continue;
            }
            if (anim.clips.some((c) => c?.name === name)) {
                return name;
            }
        }
        return custom || 'ChangeToStart';
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
        preferredClip: string,
        fallbackClip: string,
        onDone: () => void,
    ): void {
        if (!anim?.isValid) {
            onDone();
            return;
        }

        const clipName =
            this._resolveClipName(anim, preferredClip, fallbackClip) ?? '';
        if (!clipName) {
            onDone();
            return;
        }

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

        const onFinished = () => finish();

        anim.off(Animation.EventType.FINISHED, onFinished, this);
        anim.on(Animation.EventType.FINISHED, onFinished, this);
        anim.stop();
        anim.play(clipName);

        const clip = this._findClip(anim, clipName);
        const speed =
            anim.getState(clipName)?.speed ??
            (clip as AnimationClip | null)?.speed ??
            1;
        const wait = Math.max(
            0.08,
            (clip?.duration ?? 0.35) / Math.max(0.01, Math.abs(speed)) + 0.06,
        );
        this.scheduleOnce(finish, wait);
    }

    private _resolveClipName(
        anim: Animation,
        preferred: string,
        fallback: string,
    ): string | null {
        const names = [preferred.trim(), fallback.trim()];
        for (const name of names) {
            if (name && anim.clips.some((c) => c?.name === name)) {
                return name;
            }
        }
        return anim.defaultClip?.name ?? anim.clips[0]?.name ?? null;
    }

    private _findClip(anim: Animation, clipName: string): AnimationClip | null {
        return (
            anim.clips.find((c) => c?.name === clipName) ??
            anim.defaultClip ??
            anim.clips[0] ??
            null
        );
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
        const clipName =
            this.introClipName ||
            anim.defaultClip?.name ||
            anim.clips[0]?.name ||
            '';
        if (!clipName) {
            console.warn(
                '[GameIntroController] Intro Animation без клипа — только introWaitSec.',
            );
            onDone();
            return;
        }

        const onFinished = () => {
            anim.off(Animation.EventType.FINISHED, onFinished, this);
            onDone();
        };
        anim.on(Animation.EventType.FINISHED, onFinished, this);
        anim.play(clipName);
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
