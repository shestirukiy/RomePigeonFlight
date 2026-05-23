import { _decorator, Component, Widget, sys, view, screen } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Включает Widget только на вертикальном мобильном экране.
 * На ПК и при горизонтальном телефоне — выключает (ручная вёрстка / letterbox).
 * Повесьте на любую ноду, где уже есть Widget.
 */
@ccclass('PortraitMobileWidget')
export class PortraitMobileWidget extends Component {
    @property({
        type: Widget,
        displayName: 'Widget',
        tooltip:
            'Пусто — Widget на этой же ноде. Можно указать Widget на дочерней ноде.',
    })
    widget: Widget | null = null;

    @property({
        displayName: 'On Window Resize',
        tooltip:
            'Пересчитывать при смене размера окна / повороте устройства.',
    })
    refreshOnResize = true;

    @property({
        displayName: 'Invert (debug)',
        tooltip:
            'Для проверки: включить Widget там, где обычно выключается, и наоборот.',
    })
    invertLogic = false;

    private _resolved: Widget | null = null;

    onLoad() {
        this._resolved = this._resolveWidget();
        this.apply();
    }

    start() {
        this.apply();
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
    }

    /** Можно вызвать вручную после смены ориентации. */
    public apply(): void {
        const w = this._resolveWidget();
        if (!w) {
            return;
        }
        const enable = PortraitMobileWidget.shouldEnableWidget() !== this.invertLogic;
        if (w.enabled === enable) {
            return;
        }
        w.enabled = enable;
        if (enable) {
            w.updateAlignment();
        }
    }

    /** ПК / не-мобильная платформа, либо альбомная ориентация на телефоне. */
    public static shouldEnableWidget(): boolean {
        if (!sys.isMobile) {
            return false;
        }
        return !PortraitMobileWidget._isLandscapeFrame();
    }

    private static _isLandscapeFrame(): boolean {
        const win = screen.windowSize;
        if (win.width > 0 && win.height > 0) {
            return win.width > win.height;
        }
        const vis = view.getVisibleSize();
        return vis.width > vis.height;
    }

    private _resolveWidget(): Widget | null {
        if (this.widget?.isValid) {
            this._resolved = this.widget;
            return this._resolved;
        }
        this._resolved = this.getComponent(Widget);
        return this._resolved;
    }

    private _onScreenResize(): void {
        this.apply();
    }
}
