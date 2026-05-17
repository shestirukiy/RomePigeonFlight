import { _decorator, Component, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

const TAU = Math.PI * 2;

const G_POS = { id: 'Position', name: 'Position · sway' };
const G_ROT = { id: 'Rotation', name: 'Rotation · sway' };
const G_SPAWN = { id: 'Spawn', name: 'Rotation · on spawn' };
const G_SPACE = { id: 'Space', name: 'Space' };

/**
 * Лёгкое покачивание «на ветру»: объект остаётся в радиусе от точки, заданной при старте.
 * Вешайте на префаб вручную (семечко, монеты и т.д.).
 */
@ccclass('FeatherFloat')
export class FeatherFloat extends Component {
    @property({
        group: G_POS,
        displayName: 'Position Radius',
        tooltip: 'Макс. смещение от начальной позиции (пиксели).',
    })
    positionRadius = 22;

    @property({
        group: G_POS,
        displayName: 'Sway Period X (s)',
        tooltip: 'Период колебания по горизонтали. Больше — медленнее.',
    })
    swayPeriodX = 2.6;

    @property({
        group: G_POS,
        displayName: 'Sway Period Y (s)',
        tooltip: 'Период по вертикали. Чуть отличный от X — траектория «пушинка».',
    })
    swayPeriodY = 3.1;

    @property({
        group: G_POS,
        displayName: 'Randomize Phase',
        tooltip: 'Случайная фаза при появлении — объекты не качаются синхронно.',
    })
    randomizePhase = true;

    @property({
        group: G_ROT,
        displayName: 'Enable Rotation Sway',
        tooltip: 'Покачивание угла во время парения. Выкл. — угол не меняется от этого скрипта.',
    })
    enableRotationSway = true;

    @property({
        group: G_ROT,
        displayName: 'Rotation Amplitude (°)',
        tooltip: 'Размах наклона влево-вправо от якорного угла.',
        visible() {
            return (this as FeatherFloat).enableRotationSway;
        },
    })
    rotationAmplitude = 10;

    @property({
        group: G_ROT,
        displayName: 'Rotation Period (s)',
        tooltip: 'Период покачивания угла.',
        visible() {
            return (this as FeatherFloat).enableRotationSway;
        },
    })
    rotationPeriod = 4.5;

    @property({
        group: G_SPAWN,
        displayName: 'Random Spawn Rotation',
        tooltip:
            'При появлении один раз задать случайный угол в диапазоне Min…Max.',
    })
    randomSpawnRotation = true;

    @property({
        group: G_SPAWN,
        displayName: 'Spawn Rotation Min (°)',
        tooltip: 'Нижняя граница случайного угла при появлении.',
        visible() {
            return (this as FeatherFloat).randomSpawnRotation;
        },
    })
    spawnRotationMin = -18;

    @property({
        group: G_SPAWN,
        displayName: 'Spawn Rotation Max (°)',
        tooltip: 'Верхняя граница случайного угла при появлении.',
        visible() {
            return (this as FeatherFloat).randomSpawnRotation;
        },
    })
    spawnRotationMax = 18;

    @property({
        group: G_SPACE,
        displayName: 'Use Local Space',
        tooltip:
            'true — якорь в локальных координатах родителя (чанки). false — мировая позиция.',
    })
    useLocalSpace = true;

    private readonly _anchorPos = new Vec3();
    private _anchorAngle = 0;
    private _time = 0;
    private _phaseX = 0;
    private _phaseY = 0;
    private _phaseRot = 0;
    private _captured = false;

    onLoad() {
        this._applyRandomSpawnRotation();
        this._captureAnchor();
        this._initPhases();
    }

    onEnable() {
        if (!this._captured) {
            this._applyRandomSpawnRotation();
            this._captureAnchor();
            this._initPhases();
        }
    }

    /** Переснять якорь после ручного сдвига в сцене. */
    public recaptureAnchor(): void {
        this._captureAnchor();
    }

    private _applyRandomSpawnRotation(): void {
        if (!this.randomSpawnRotation || !this.node?.isValid) {
            return;
        }
        const min = Math.min(this.spawnRotationMin, this.spawnRotationMax);
        const max = Math.max(this.spawnRotationMin, this.spawnRotationMax);
        this.node.angle = min + Math.random() * (max - min);
    }

    private _captureAnchor(): void {
        if (this.useLocalSpace) {
            this._anchorPos.set(this.node.position);
        } else {
            this._anchorPos.set(this.node.worldPosition);
        }
        this._anchorAngle = this.node.angle;
        this._captured = true;
    }

    private _initPhases(): void {
        if (!this.randomizePhase) {
            this._phaseX = 0;
            this._phaseY = 0;
            this._phaseRot = 0;
            return;
        }
        this._phaseX = Math.random() * TAU;
        this._phaseY = Math.random() * TAU;
        this._phaseRot = Math.random() * TAU;
    }

    update(dt: number) {
        if (!this._captured || !this.node?.isValid) {
            return;
        }

        this._time += dt;
        const r = Math.max(0, this.positionRadius);
        const px = Math.max(0.05, this.swayPeriodX);
        const py = Math.max(0.05, this.swayPeriodY);

        let dx = r * Math.sin((TAU / px) * this._time + this._phaseX);
        let dy =
            r *
            0.92 *
            Math.sin((TAU / py) * this._time + this._phaseY + 0.7);

        const len = Math.hypot(dx, dy);
        if (len > r && len > 1e-6) {
            const k = r / len;
            dx *= k;
            dy *= k;
        }

        if (this.useLocalSpace) {
            this.node.setPosition(
                this._anchorPos.x + dx,
                this._anchorPos.y + dy,
                this._anchorPos.z,
            );
        } else {
            this.node.setWorldPosition(
                this._anchorPos.x + dx,
                this._anchorPos.y + dy,
                this._anchorPos.z,
            );
        }

        if (this.enableRotationSway && this.rotationAmplitude !== 0) {
            const pr = Math.max(0.05, this.rotationPeriod);
            const wobble =
                this.rotationAmplitude *
                Math.sin((TAU / pr) * this._time + this._phaseRot);
            this.node.angle = this._anchorAngle + wobble;
        }
    }
}
