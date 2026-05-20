import {
    _decorator,
    Animation,
    Canvas,
    Component,
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
 * Запуск сцены: камера на introPosition, ждём любой клик → (опц.) клип → панорама на gameplayPosition.
 * После Play Again (рестарт внутри сессии) — без заставки, сразу игровая камера.
 * Без localStorage: только флаг сессии, сбрасывается при перезагрузке сцены.
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

    private _blockingInput = false;
    /** Ждём первый клик перед клипом / панорамой камеры. */
    private _awaitingUserTap = false;
    private _running = false;
    private _panTween: Tween<Node> | null = null;
    private readonly _gameplayRest = new Vec3();

    /** Блокировать старт забега: ожидание клика для заставки и во время панорамы. */
    public get isBlockingInput(): boolean {
        return this._blockingInput;
    }

    /**
     * Первый клик по экрану запускает заставку (панораму). Возвращает true, если клик принят.
     */
    public tryConsumeIntroTap(): boolean {
        if (!this._awaitingUserTap || !this._shouldPlayIntro()) {
            return false;
        }
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
                '[GameIntroController] Заставка: камера на introPosition. Клик — начало панорамы.',
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
    }

    onDestroy() {
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
