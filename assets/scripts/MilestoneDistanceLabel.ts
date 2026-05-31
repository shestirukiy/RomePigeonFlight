import { _decorator, Component, Label, Tween, tween } from 'cc';

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

    private _rollCounter = { value: 0 };
    private _rollTween: Tween<{ value: number }> | null = null;

    onLoad() {
        this._resolveLabel();
    }

    onDestroy() {
        this.stopMetersRoll();
    }

    public setMeters(meters: number): void {
        this.stopMetersRoll();
        this._applyMetersToLabel(meters);
    }

    /**
     * Бегущие цифры 0 → target за фиксированное время (не зависит от величины target).
     */
    public playMetersRollFromZero(
        targetMeters: number,
        durationSec: number,
    ): void {
        this._resolveLabel();
        if (!this.label?.isValid) {
            return;
        }

        this.stopMetersRoll();

        const target = Math.max(0, Math.floor(targetMeters));
        this._rollCounter.value = 0;
        this.label.string = '0';

        if (target <= 0) {
            return;
        }

        const duration = Math.max(0.05, durationSec);
        this._rollTween = tween(this._rollCounter)
            .to(
                duration,
                { value: target },
                {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (!this.isValid || !this.label?.isValid) {
                            return;
                        }
                        this.label.string = `${Math.round(this._rollCounter.value)}`;
                    },
                },
            )
            .call(() => {
                this._rollTween = null;
                if (this.isValid) {
                    this._applyMetersToLabel(target);
                }
            })
            .start();
    }

    public stopMetersRoll(): void {
        if (this._rollTween) {
            this._rollTween.stop();
            this._rollTween = null;
        }
        if (!this._rollCounter) {
            this._rollCounter = { value: 0 };
            return;
        }
        this._rollCounter.value = 0;
    }

    private _applyMetersToLabel(meters: number): void {
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
            this.node.getChildByName('LabelMeters') ??
            this.node.getChildByName('Label') ??
            this.node.getChildByName('label');
        this.label =
            labelNode?.getComponent(Label) ??
            this.getComponentInChildren(Label);
    }
}
