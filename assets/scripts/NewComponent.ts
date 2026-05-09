import { _decorator, Component, input, Input, EventMouse, EventTouch } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Гейм-луп: первый тап запускает игру, затем Sky/TownBack едут влево.
 * Имя класса = имя в @ccclass (требование Cocos для привязки из сцены).
 */
@ccclass('NewComponent')
export class NewComponent extends Component {
    private static _inst: NewComponent | null = null;

    /** Доступ как «менеджер» из других скриптов */
    public static get game(): NewComponent | null {
        return NewComponent._inst;
    }

    private _playing = false;

    public get isPlaying(): boolean {
        return this._playing;
    }

    @property
    scrollSpeed = 280;

    @property
    townSpeedMultiplier = 1.15;

    @property
    skyChildName = 'Sky';

    @property
    townChildName = 'TownBack';

    onLoad() {
        NewComponent._inst = this;
        input.on(Input.EventType.TOUCH_START, this._onInputStart, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this._onInputStart, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        if (NewComponent._inst === this) {
            NewComponent._inst = null;
        }
    }

    update(dt: number) {
        if (!this._playing) {
            return;
        }

        const canvas = this.node;
        const sky = canvas.getChildByName(this.skyChildName);
        const town = canvas.getChildByName(this.townChildName);

        if (sky) {
            const p = sky.position;
            sky.setPosition(p.x - this.scrollSpeed * dt, p.y, p.z);
        }
        if (town) {
            const p = town.position;
            const sp = this.scrollSpeed * this.townSpeedMultiplier * dt;
            town.setPosition(p.x - sp, p.y, p.z);
        }
    }

    private _tryStart() {
        if (this._playing) {
            return;
        }
        this._playing = true;
    }

    private _onInputStart(_e: EventTouch) {
        this._tryStart();
    }

    private _onMouseDown(e: EventMouse) {
        if (e.getButton() === 0) {
            this._tryStart();
        }
    }
}
