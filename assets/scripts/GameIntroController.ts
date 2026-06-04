import {
    _decorator,
    Animation,
    Canvas,
    Component,
    director,
    Label,
    Node,
    tween,
    Tween,
    Vec3,
} from 'cc';
import { CameraShake } from './CameraShake';

const { ccclass, property, executionOrder } = _decorator;

const G_INTRO = { id: 'Intro', name: 'First launch intro' };
const G_CAM = { id: 'Camera', name: 'Camera pan' };

/**
 * Запуск сцены: камера на introPosition, печать текста, затем ContinueBttn → панорама.
 * Клики по экрану на заставке не обрабатываются — только кнопка Continue (GameManager).
 * После Play Again (рестарт внутри сессии) — без заставки, сразу игровая камера.
 */
@ccclass('GameIntroController')
@executionOrder(-100)
export class GameIntroController extends Component {
    private static _inst: GameIntroController | null = null;

    /** true после Play Again — до новой загрузки сцены (не static — иначе залипает в превью редактора). */
    private _skipIntroAfterRestart = false;

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
        displayName: 'Label Board Name',
        tooltip: 'Имя ноды с Label в Chunk_Start (по умолчанию LabelBoard).',
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

    private _blockingInput = false;
    /** Ждём клик для панорамы камеры (после допечатки текста). */
    private _awaitingUserTap = false;
    private _running = false;
    private _label: Label | null = null;
    private _introBoardAnim: Animation | null = null;
    private _fullLabelText = '';
    private _typewriterCharIndex = 0;
    private _typewriterDone = false;
    /** Один физический клик = touch + mouse в одном кадре — не пускать сразу на камеру. */
    private _introTapFrame = -1;
    private _panTween: Tween<Node> | null = null;
    private readonly _gameplayRest = new Vec3();

    /** Блокировать старт забега: ожидание клика для заставки и во время панорамы. */
    public get isBlockingInput(): boolean {
        return this._blockingInput;
    }

    /**
     * ContinueBttn на заставке: допечатка / SkipTextScroll / панорама камеры.
     * Возвращает true, если нажатие обработано заставкой.
     */
    public tryConsumeIntroTap(): boolean {
        if (!this._shouldPlayIntro() || this._running) {
            return false;
        }

        const frame = director.getTotalFrames();
        if (frame === this._introTapFrame) {
            return true;
        }

        if (this._label && !this._typewriterDone) {
            this._completeTypewriterInstant();
            this._introTapFrame = frame;
            return true;
        }

        if (!this._awaitingUserTap) {
            return false;
        }

        this._introTapFrame = frame;
        this._awaitingUserTap = false;
        this._runIntroSequence();
        return true;
    }

    /** Вызвать из GameManager.returnToTapToStart — больше не показывать заставку до перезагрузки сцены. */
    public static skipIntroAfterRestart(): void {
        GameIntroController._inst?._markSkipIntroAfterRestart();
    }

    private _markSkipIntroAfterRestart(): void {
        this._skipIntroAfterRestart = true;
    }

    onLoad() {
        GameIntroController._inst = this;
        const cam = this._resolveCamera();
        if (cam) {
            this.gameplayPosition.z = cam.position.z;
        }
        this._gameplayRest.set(this.gameplayPosition);

        if (this._shouldPlayIntro()) {
            this._blockingInput = true;
            this._awaitingUserTap = true;
            this._applyIntroCamera(cam);
            console.log(
                '[GameIntroController] Заставка: печать LabelBoard → ContinueBttn → SkipTextScroll → панорама.',
            );
            this.scheduleOnce(() => this._applyIntroCamera(this._resolveCamera()), 0);
        } else {
            this.snapToGameplayCamera();
        }
    }

    start() {
        if (!this._shouldPlayIntro()) {
            return;
        }
        this._applyIntroCamera(this._resolveCamera());
        this._tryStartIntroContent(0);
    }

    onDestroy() {
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
        return !this._skipIntroAfterRestart;
    }

    private _tryStartIntroContent(attempt: number): void {
        if (!this._shouldPlayIntro() || this._running) {
            return;
        }

        if (!this._introBoardAnim?.isValid) {
            this._introBoardAnim = this._findIntroBoardAnimation();
        }

        const label = this._findLabelBoard();
        if (label) {
            this._label = label;
            this._fullLabelText = label.string;
            this._typewriterCharIndex = 0;
            this._typewriterDone = false;
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

    private _findNodeByName(nodeName: string): Node | null {
        const scene = this.node.scene;
        if (!scene?.isValid) {
            return null;
        }
        const targetName = nodeName.trim();
        if (!targetName) {
            return null;
        }
        const stack: Node[] = [scene];
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
        const node = this._findNodeByName(this.labelBoardNodeName || 'LabelBoard');
        return node?.getComponent(Label) ?? null;
    }

    private _findIntroBoardAnimation(): Animation | null {
        const node = this._findNodeByName(
            this.introBoardNodeName || 'IntroBoard',
        );
        return node?.getComponent(Animation) ?? null;
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

    /** Текст допечатан (сам или по клику) — проигрываем SkipTextScroll на IntroBoard. */
    private _finishTypewriter(): void {
        if (this._typewriterDone) {
            return;
        }
        this._stopTypewriter();
        this._typewriterDone = true;
        this._playSkipTextScroll();
    }

    private _playSkipTextScroll(): void {
        const anim =
            this._introBoardAnim?.isValid
                ? this._introBoardAnim
                : this._findIntroBoardAnimation();
        if (!anim?.isValid) {
            console.warn(
                `[GameIntroController] "${this.introBoardNodeName}" / Animation не найден — SkipTextScroll пропущен.`,
            );
            return;
        }
        this._introBoardAnim = anim;

        const clipName =
            this.skipTextScrollClipName.trim() ||
            anim.defaultClip?.name ||
            anim.clips[0]?.name ||
            'SkipTextScroll';
        if (!clipName) {
            return;
        }
        anim.stop();
        anim.play(clipName);
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
        const canvas =
            this.getComponent(Canvas) ??
            this.node.getComponent(Canvas) ??
            this.node.parent?.getComponent(Canvas) ??
            null;
        return canvas?.cameraComponent?.node ?? null;
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
