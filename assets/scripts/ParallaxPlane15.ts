import { _decorator, Component, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { LevelGenerator } from './LevelGenerator';

const { ccclass, property } = _decorator;

/**
 * «Полторашный» параллакс: узел на чанке плана 1, визуально ближе к плану 2.
 * Смещение от «родной» local-позиции зависит только от X относительно центра (0):
 * левее центра — чуть влево, правее — чуть вправо, в X≈0 — ровно как в префабе.
 */
@ccclass('ParallaxPlane15')
export class ParallaxPlane15 extends Component {
    @property({
        displayName: 'Skew Scale',
        tooltip:
            'Сила смещения: (plane2−plane1) × этот множитель. 1 = как разница слоёв; 0.25–0.5 обычно «чуть».',
    })
    skewScale = 0.35;

    private readonly _baseLocal = new Vec3();
    private readonly _nominalWorld = new Vec3();
    private _captured = false;

    onEnable() {
        this._captureBase();
    }

    onDisable() {
        this._applyBaseOnly();
    }

    lateUpdate() {
        if (!this._captured) {
            this._captureBase();
        }
        if (!GameManager.game?.isPlaying) {
            this._applyBaseOnly();
            return;
        }

        const parent = this.node.parent;
        if (!parent?.isValid) {
            return;
        }

        const strength = this._skewStrength();
        Vec3.transformMat4(this._nominalWorld, this._baseLocal, parent.worldMatrix);
        const skewX = this._nominalWorld.x * strength;

        const p = this.node.position;
        this.node.setPosition(this._baseLocal.x + skewX, p.y, p.z);
    }

    private _skewStrength(): number {
        const lg = GameManager.game?.getComponent(LevelGenerator);
        const f1 = Math.max(1e-6, lg?.plane1ParallaxFactor ?? 0.4);
        const f2 = lg?.plane2ParallaxFactor ?? 0.72;
        return (f2 - f1) * this.skewScale;
    }

    private _captureBase(): void {
        this._baseLocal.set(this.node.position);
        this._captured = true;
    }

    private _applyBaseOnly(): void {
        const p = this.node.position;
        this.node.setPosition(this._baseLocal.x, p.y, p.z);
    }
}
