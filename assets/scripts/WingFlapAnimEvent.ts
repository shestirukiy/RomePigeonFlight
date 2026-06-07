import { _decorator, Component } from 'cc';
import { GameIntroController } from './GameIntroController';
import { SoundController } from './SoundController';

const { ccclass } = _decorator;

/**
 * Обработчик Animation Event на клипе (например PFall6 → StartfLy).
 * Wing-flap слышен только после StartGame, когда включён loop CrowdSpawner.
 */
@ccclass('WingFlapAnimEvent')
export class WingFlapAnimEvent extends Component {
    /** Имя события в клипе PFall6 (как задано в Animation). */
    public StartfLy(): void {
        this._playWingFlap();
    }

    /** Альias, если в клипе событие названо StartFly. */
    public StartFly(): void {
        this._playWingFlap();
    }

    private _playWingFlap(): void {
        if (!GameIntroController.isCrowdWingFlapEnabled()) {
            return;
        }
        SoundController.instance?.tryPlayWingFlap();
    }
}
