import {
    _decorator,
    Color,
    Component,
    Material,
    Sprite,
} from 'cc';

const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

/**
 * Полупрозрачный цветной слой поверх оригинальной текстуры спрайта
 * (materials/SpriteTintOverlay + effects/sprite-tint-overlay).
 */
@ccclass('SpriteTintOverlay')
@executeInEditMode(true)
@requireComponent(Sprite)
export class SpriteTintOverlay extends Component {
    @property({
        type: Material,
        displayName: 'Material Template',
        tooltip: 'Материал SpriteTintOverlay.mtl на базе effects/sprite-tint-overlay.',
    })
    materialTemplate: Material | null = null;

    @property({
        displayName: 'Tint Color',
        tooltip:
            'Цвет наложения. Альфа цвета × Tint Strength — насколько сильно виден тинт (0 = только текстура).',
    })
    tintColor = new Color(255, 0, 0, 128);

    @property({
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        displayName: 'Tint Strength',
        tooltip: 'Доп. множитель силы тинта поверх альфы Tint Color.',
    })
    tintStrength = 0.5;

    private _materialInstance: Material | null = null;

    onLoad() {
        this._ensureMaterial();
        this.applyTint();
    }

    onEnable() {
        this.applyTint();
    }

    public applyTint(): void {
        const mat = this._ensureMaterial();
        if (!mat) {
            return;
        }
        const c = this.tintColor;
        mat.setProperty('tintColor', {
            r: c.r / 255,
            g: c.g / 255,
            b: c.b / 255,
            a: c.a / 255,
        });
        mat.setProperty('tintStrength', this.tintStrength);
    }

    private _ensureMaterial(): Material | null {
        const sprite = this.getComponent(Sprite);
        if (!sprite) {
            return null;
        }

        if (this._materialInstance?.isValid) {
            sprite.customMaterial = this._materialInstance;
            return this._materialInstance;
        }

        const existing = sprite.customMaterial;
        if (existing?.isValid && !this.materialTemplate) {
            this._materialInstance = existing;
            return existing;
        }

        const template = this.materialTemplate ?? existing;
        if (!template?.isValid) {
            return null;
        }

        const inst = new Material();
        inst.copy(template);
        this._materialInstance = inst;
        sprite.customMaterial = inst;
        return inst;
    }
}
