import { _decorator, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Отображение метров на табличке. Вешается на Chunk_Sign или Sign (game over);
 * в инспекторе перетащите свой Label.
 */
@ccclass('MilestoneDistanceLabel')
export class MilestoneDistanceLabel extends Component {
    @property({
        type: Label,
        displayName: 'Distance Label',
        tooltip: 'Label с цифрой дистанции (настройте вид в редакторе).',
    })
    label: Label | null = null;

    onLoad() {
        this._resolveLabel();
    }

    public setMeters(meters: number): void {
        this._resolveLabel();
        if (!this.label?.isValid) {
            return;
        }
        this.label.string = `${Math.max(0, Math.floor(meters))}`;
    }

    private _resolveLabel(): void {
        if (this.label?.isValid) {
            return;
        }
        const labelNode =
            this.node.getChildByName('Label') ??
            this.node.getChildByName('label');
        this.label =
            labelNode?.getComponent(Label) ??
            this.getComponentInChildren(Label);
    }
}
