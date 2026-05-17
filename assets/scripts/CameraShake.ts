import { _decorator, Component, Node, tween, Tween, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Случайное смещение узла камеры (обычно дочерний Camera на Canvas).
 * Вешать на узел, который нужно трясти; вызывать из GameManager при уроне.
 */
@ccclass('CameraShake')
export class CameraShake extends Component {
    private static _inst: CameraShake | null = null;

    public static get instance(): CameraShake | null {
        return CameraShake._inst;
    }

    @property({
        displayName: 'Shake Duration',
        tooltip: 'Длительность дрожания (сек).',
    })
    shakeDuration = 0.15;

    @property({
        displayName: 'Shake Intensity',
        tooltip: 'Амплитуда смещения по X/Y (пиксели).',
    })
    shakeIntensity = 5;

    @property({
        displayName: 'Shake Frequency',
        tooltip: 'Интервал между смещениями (сек).',
    })
    shakeFrequency = 0.02;

    private readonly _originalPosition = new Vec3();
    private _activeTween: Tween<Node> | null = null;

    onLoad() {
        CameraShake._inst = this;
        this._captureRestPosition();
    }

    onDestroy() {
        this._stopShakeTween();
        if (CameraShake._inst === this) {
            CameraShake._inst = null;
        }
    }

    /** Стандартная тряска при потере HP. */
    public shakeOnDamage(): void {
        this.shake(1);
    }

    /**
     * @param intensityMultiplier Множитель амплитуды (1 = shakeIntensity).
     */
    public shake(intensityMultiplier = 1): void {
        const intensity = this.shakeIntensity * intensityMultiplier;
        if (intensity <= 0 || this.shakeDuration <= 0) {
            return;
        }

        this._stopShakeTween();

        const frequency = Math.max(0.01, this.shakeFrequency);
        const steps = Math.max(1, Math.floor(this.shakeDuration / frequency));
        const shakeTween = tween(this.node);

        for (let i = 0; i < steps; i++) {
            const offsetX = (Math.random() - 0.5) * 2 * intensity;
            const offsetY = (Math.random() - 0.5) * 2 * intensity;
            const targetPos = new Vec3(
                this._originalPosition.x + offsetX,
                this._originalPosition.y + offsetY,
                this._originalPosition.z,
            );
            shakeTween.to(frequency, { position: targetPos }, { easing: 'linear' });
        }

        shakeTween
            .to(frequency, { position: this._originalPosition.clone() }, {
                easing: 'linear',
            })
            .call(() => {
                this._activeTween = null;
                this.node.setPosition(this._originalPosition);
            });

        this._activeTween = shakeTween;
        shakeTween.start();
    }

    private _captureRestPosition(): void {
        this._originalPosition.set(this.node.position);
    }

    private _stopShakeTween(): void {
        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        } else {
            Tween.stopAllByTarget(this.node);
        }
        this.node.setPosition(this._originalPosition);
    }
}
