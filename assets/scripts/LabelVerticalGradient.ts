import {
    _decorator,
    Color,
    Component,
    Label,
    Material,
    Vec4,
} from 'cc';

const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

/**
 * Опционально: градиент через копию материала на ноде (effects/text-gradient).
 * Для правки в редакторе удобнее три пресета: gradient-text-red / -blue / -gold.mtl
 * в Label → Custom Material (у каждого файла свои настройки).
 */
@ccclass('LabelVerticalGradient')
@executeInEditMode(true)
@requireComponent(Label)
export class LabelVerticalGradient extends Component {
    @property({
        type: Material,
        displayName: 'Material Template',
        tooltip:
            'Шаблон (например gradient-text-gold.mtl). Для наглядной настройки в редакторе используйте пресеты -red/-blue/-gold на Label.',
    })
    materialTemplate: Material | null = null;

    @property({ displayName: 'Color Top' })
    colorTop = new Color(255, 242, 102, 255);

    @property({ displayName: 'Color Bottom' })
    colorBottom = new Color(230, 51, 38, 255);

    @property({
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        displayName: 'Gradient Boundary',
        tooltip:
            'По вертикали текста (0 — низ, 1 — верх): где проходит граница между Color Bottom и Color Top.',
    })
    gradientBoundary = 0.5;

    @property({
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        displayName: 'Gradient Smoothness',
        tooltip:
            'Ширина плавного перехода. 0 — резкая граница, 1 — мягкий градиент на всю высоту.',
    })
    gradientSoftness = 1;

    @property({
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        displayName: 'Gradient Strength',
        tooltip: '1 — только градиент; 0 — исходные цвета текстуры Label.',
    })
    gradientStrength = 1;

    @property({
        displayName: 'Invert Gradient',
        tooltip: 'Поменять местами верх и низ (Color Top ↔ низ UV).',
    })
    invertGradient = false;

    private _materialInstance: Material | null = null;

    onLoad() {
        this._ensureMaterial();
        this.applyGradient();
    }

    onEnable() {
        this.applyGradient();
    }

    onDestroy() {
        if (this._materialInstance?.isValid) {
            this._materialInstance.destroy();
            this._materialInstance = null;
        }
    }

    onValidate() {
        this._ensureMaterial();
        this.applyGradient();
    }

    public applyGradient(): void {
        const mat = this._ensureMaterial();
        if (!mat) {
            return;
        }

        const top = this.colorTop;
        mat.setProperty('colorTop', {
            r: top.r / 255,
            g: top.g / 255,
            b: top.b / 255,
            a: top.a / 255,
        });
        const bottom = this.colorBottom;
        mat.setProperty('colorBottom', {
            r: bottom.r / 255,
            g: bottom.g / 255,
            b: bottom.b / 255,
            a: bottom.a / 255,
        });
        mat.setProperty(
            'gradientParams',
            new Vec4(
                this.gradientBoundary,
                this.gradientSoftness,
                this.gradientStrength,
                this.invertGradient ? 1 : 0,
            ),
        );
    }

    private _ensureMaterial(): Material | null {
        const label = this.getComponent(Label);
        if (!label) {
            return null;
        }

        const template = this.materialTemplate ?? label.customMaterial;
        if (!template?.isValid) {
            return null;
        }

        const bound = label.customMaterial;
        const ownsInstance =
            this._materialInstance?.isValid &&
            bound === this._materialInstance;

        if (!ownsInstance) {
            if (!this._materialInstance?.isValid) {
                this._materialInstance = new Material();
            }
            this._materialInstance.copy(template);
            label.customMaterial = this._materialInstance;
        }

        return this._materialInstance;
    }
}
