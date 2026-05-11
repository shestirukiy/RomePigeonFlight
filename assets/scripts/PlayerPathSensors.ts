import {
    _decorator,
    Component,
    Collider2D,
    Contact2DType,
    IPhysics2DContact,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Два сенсора на игроке: Front/Back.
 * Нужны, чтобы понять “путь вперёд/назад закрыт” и останавливать движение мира, а не камеру/игрока.
 */
@ccclass('PlayerPathSensors')
export class PlayerPathSensors extends Component {
    @property({
        type: Collider2D,
        displayName: 'Front Sensor',
        tooltip: 'Сенсор спереди (по ходу движения мира влево).',
    })
    frontSensor: Collider2D | null = null;

    @property({
        type: Collider2D,
        displayName: 'Back Sensor',
        tooltip: 'Сенсор сзади (для отскока, когда мир едет вправо).',
    })
    backSensor: Collider2D | null = null;

    @property({
        displayName: 'Obstacle Group',
        tooltip:
            'Группа коллайдеров, которые считаем “непроходимыми”. См. _group у BoxCollider2D в сцене/префабах.',
    })
    obstacleGroup = 1;

    private _frontCount = 0;
    private _backCount = 0;

    public get isFrontBlocked(): boolean {
        return this._frontCount > 0;
    }

    public get isBackBlocked(): boolean {
        return this._backCount > 0;
    }

    onLoad() {
        // Автопоиск по имени, если не задано в инспекторе
        if (!this.frontSensor) {
            const n = this.node.getChildByName('FrontSensor');
            this.frontSensor = n?.getComponent(Collider2D) ?? null;
        }
        if (!this.backSensor) {
            const n = this.node.getChildByName('BackSensor');
            this.backSensor = n?.getComponent(Collider2D) ?? null;
        }

        this._frontCount = 0;
        this._backCount = 0;

        this._bind(this.frontSensor, true);
        this._bind(this.backSensor, false);
    }

    onDestroy() {
        this._unbind(this.frontSensor);
        this._unbind(this.backSensor);
    }

    private _bind(sensor: Collider2D | null, isFront: boolean): void {
        if (!sensor?.isValid) {
            return;
        }
        sensor.on(
            Contact2DType.BEGIN_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onBegin(isFront, self, other, c),
            this,
        );
        sensor.on(
            Contact2DType.END_CONTACT,
            (self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) =>
                this._onEnd(isFront, self, other, c),
            this,
        );
    }

    private _unbind(sensor: Collider2D | null): void {
        if (!sensor?.isValid) {
            return;
        }
        sensor.off(Contact2DType.BEGIN_CONTACT);
        sensor.off(Contact2DType.END_CONTACT);
    }

    private _isBlockingObstacle(other: Collider2D): boolean {
        if (!other?.isValid) {
            return false;
        }
        // Реагируем только на "твёрдые" коллайдеры (Sensor = false).
        // Так сенсоры игрока будут игнорировать триггеры/зоны, через которые можно пролетать.
        const otherAny = other as any;
        const isOtherSensor = otherAny.sensor === true || otherAny._sensor === true;
        if (isOtherSensor) {
            return false;
        }
        // Игнорируем любые коллайдеры внутри игрока.
        const otherNode = other.node;
        if (otherNode === this.node || otherNode.isChildOf(this.node)) {
            return false;
        }
        // Фильтр по группе препятствий.
        return (other as any)._group === this.obstacleGroup;
    }

    private _onBegin(
        isFront: boolean,
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        if (!this._isBlockingObstacle(other)) {
            return;
        }
        if (isFront) {
            this._frontCount++;
        } else {
            this._backCount++;
        }
    }

    private _onEnd(
        isFront: boolean,
        _self: Collider2D,
        other: Collider2D,
        _contact: IPhysics2DContact | null,
    ) {
        if (!this._isBlockingObstacle(other)) {
            return;
        }
        if (isFront) {
            this._frontCount = Math.max(0, this._frontCount - 1);
        } else {
            this._backCount = Math.max(0, this._backCount - 1);
        }
    }
}

