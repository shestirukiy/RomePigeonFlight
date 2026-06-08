import {
    _decorator,
    Component,
    Node,
    screen,
    UITransform,
    Vec3,
    view,
} from 'cc';
import { SceneNodeHub } from './SceneNodeHub';

const { ccclass, property } = _decorator;

/**
 * Многострочная раскладка HP: ряд вправо как раньше, перенос на следующий ряд
 * со сдвигом row2Reference − anchor (вниз и вправо). Одинаково в portrait и landscape.
 */
@ccclass('HpHeartLayout')
export class HpHeartLayout extends Component {
    @property({
        type: Node,
        displayName: 'Anchor (hp_Icon)',
        tooltip: 'Первое сердечко, начало ряда 1.',
    })
    anchor: Node | null = null;

    @property({
        type: Node,
        displayName: 'Row 2 Reference (hp_Icon2r)',
        tooltip:
            'Позиция начала 2-го ряда. Сдвиг ряда = эта нода − Anchor (накапливается для 3-го, 4-го …).',
    })
    row2Reference: Node | null = null;

    @property({
        type: Node,
        displayName: 'Bounds Root',
        tooltip:
            'Ширина игровой зоны (без letterbox). Пусто — View Root / Canvas из SceneNodeHub.',
    })
    boundsRoot: Node | null = null;

    @property({
        displayName: 'Heart Spacing X',
        tooltip:
            'Единственная настройка зазора между сердечками. Шаг = ширина UITransform якоря + это значение.',
    })
    heartSpacingX = 4;

    @property({
        displayName: 'Refresh On Resize',
        tooltip: 'Пересчёт heartsPerRow при смене размера окна / canvas.',
    })
    refreshOnResize = true;

    private _rowOffset = new Vec3();
    private _heartsPerRow = 1;
    private _relayoutHandler: (() => void) | null = null;
    private static readonly _vTmpA = new Vec3();
    private static readonly _vTmpB = new Vec3();
    private static readonly _vTmpC = new Vec3();

    onLoad() {
        this._refreshLayoutMetrics();
    }

    start() {
        this._refreshLayoutMetrics();
        if (this.refreshOnResize) {
            screen.on('window-resize', this._onScreenResize, this);
            view.on('design-resolution-changed', this._onScreenResize, this);
            view.on('canvas-resize', this._onScreenResize, this);
        }
    }

    onDestroy() {
        screen.off('window-resize', this._onScreenResize, this);
        view.off('design-resolution-changed', this._onScreenResize, this);
        view.off('canvas-resize', this._onScreenResize, this);
        this._relayoutHandler = null;
    }

    public setRelayoutHandler(handler: (() => void) | null): void {
        this._relayoutHandler = handler;
    }

    public getHeartsPerRow(): number {
        return this._heartsPerRow;
    }

    public getHeartStepX(): number {
        return this._heartStepX();
    }

    /** Локальная rest-позиция слота в родителе anchor. */
    public computeSlotLocalPosition(index: number, out = new Vec3()): Vec3 {
        const anchor = this.anchor;
        if (!anchor?.isValid || index < 0) {
            out.set(0, 0, 0);
            return out;
        }

        this._refreshLayoutMetrics();

        const perRow = Math.max(1, this._heartsPerRow);
        const row = Math.floor(index / perRow);
        const col = index % perRow;
        const stepX = this._heartStepX();
        const base = anchor.position;

        out.set(
            base.x + this._rowOffset.x * row + stepX * col,
            base.y + this._rowOffset.y * row,
            base.z + this._rowOffset.z * row,
        );
        return out;
    }

    /** Применить раскладку к уже созданным нодам сердечек (порядок = индекс слота). */
    public applyPositions(hearts: readonly Node[]): void {
        for (let i = 0; i < hearts.length; i++) {
            const heart = hearts[i];
            if (!heart?.isValid) {
                continue;
            }
            const pos = this.computeSlotLocalPosition(i, HpHeartLayout._vTmpA);
            heart.setPosition(pos);
        }
    }

    private _onScreenResize = (): void => {
        const prev = this._heartsPerRow;
        this._refreshLayoutMetrics();
        if (this._heartsPerRow !== prev) {
            this._relayoutHandler?.();
        }
    };

    private _refreshLayoutMetrics(): void {
        this._cacheRowOffset();
        this._heartsPerRow = this._computeHeartsPerRow();
    }

    private _cacheRowOffset(): void {
        const anchor = this.anchor;
        const row2 = this.row2Reference;
        if (!anchor?.isValid) {
            this._rowOffset.set(0, 0, 0);
            return;
        }
        if (!row2?.isValid) {
            this._rowOffset.set(0, 0, 0);
            return;
        }
        Vec3.subtract(this._rowOffset, row2.position, anchor.position);
    }

    private _heartStepX(): number {
        const ui = this.anchor?.getComponent(UITransform);
        const w = ui?.contentSize.width ?? 64;
        return w + this.heartSpacingX;
    }

    private _resolveBoundsRoot(): Node | null {
        if (this.boundsRoot?.isValid) {
            return this.boundsRoot;
        }
        const hub = SceneNodeHub.instance;
        if (hub?.viewRoot?.isValid) {
            return hub.viewRoot;
        }
        if (hub?.canvasRoot?.isValid) {
            return hub.canvasRoot;
        }
        return this.node;
    }

    /**
     * Сколько сердечек помещается в один ряд до переноса.
     * Ширина — игровая зона (viewRoot), не letterbox.
     */
    private _computeHeartsPerRow(): number {
        const anchor = this.anchor;
        const bounds = this._resolveBoundsRoot();
        const parent = anchor?.parent;
        if (!anchor?.isValid || !bounds?.isValid || !parent?.isValid) {
            return 1;
        }

        const stepX = this._heartStepX();
        if (stepX <= 1e-3) {
            return 1;
        }

        const boundsUi = bounds.getComponent(UITransform);
        const parentUi = parent.getComponent(UITransform);
        if (!boundsUi || !parentUi) {
            return 1;
        }

        const rightLocal = HpHeartLayout._boundsRightInParentLocal(
            boundsUi,
            parentUi,
        );
        const anchorUi = anchor.getComponent(UITransform);
        const halfW = (anchorUi?.contentSize.width ?? 64) * 0.5;
        const maxCenterX = rightLocal.x - halfW;
        const startX = anchor.position.x;

        if (maxCenterX <= startX + 1e-3) {
            return 1;
        }

        return Math.max(1, Math.floor((maxCenterX - startX) / stepX) + 1);
    }

    /** Правый край boundsRoot в локали родителя сердечек. */
    private static _boundsRightInParentLocal(
        boundsUi: UITransform,
        parentUi: UITransform,
    ): Vec3 {
        const ax = boundsUi.anchorX;
        const w = boundsUi.contentSize.width;
        HpHeartLayout._vTmpB.set(w * (1 - ax), 0, 0);
        boundsUi.convertToWorldSpaceAR(HpHeartLayout._vTmpB, HpHeartLayout._vTmpC);
        parentUi.convertToNodeSpaceAR(HpHeartLayout._vTmpC, HpHeartLayout._vTmpA);
        return HpHeartLayout._vTmpA;
    }
}
