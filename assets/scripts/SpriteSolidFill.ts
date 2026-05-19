import {
    _decorator,
    Color,
    Component,
    Material,
    Sprite,
} from 'cc';

const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

/**
 * Однородная заливка спрайта по его альфе (нужен материал SpriteSolidFill + effect sprite-solid-fill).
 * На Sprite: Custom Material = SpriteSolidFill.mtl (или шаблон ниже).
 */
@ccclass('SpriteSolidFill')
@executeInEditMode(true)
@requireComponent(Sprite)
export class SpriteSolidFill extends Component {
    @property({
        type: Material,
        displayName: 'Material Template',
        tooltip:
            'Материал на базе effects/sprite-solid-fill. Пусто — ищется materials/SpriteSolidFill.',
    })
    materialTemplate: Material | null = null;

    @property({
        displayName: 'Fill Color',
        tooltip: 'RGB заливки; альфа канала цвета тоже участвует в итоговой прозрачности.',
    })
    fillColor = new Color(255, 0, 0, 255);

    @property({
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        displayName: 'Fill Opacity',
        tooltip: 'Доп. множитель прозрачности заливки (0 — невидимо, 1 — полная сила цвета).',
    })
    fillOpacity = 0.5;

    private _materialInstance: Material | null = null;

    onLoad() {
        this._ensureMaterial();
        this.applyFill();
    }

    onEnable() {
        this.applyFill();
    }

    public applyFill(): void {
        const mat = this._ensureMaterial();
        if (!mat) {
            return;
        }
        const c = this.fillColor;
        mat.setProperty('fillColor', {
            r: c.r / 255,
            g: c.g / 255,
            b: c.b / 255,
            a: c.a / 255,
        });
        mat.setProperty('fillOpacity', this.fillOpacity);
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
