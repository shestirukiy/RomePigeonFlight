import { _decorator, Component, Node } from 'cc';
import { GameManager } from './GameManager';
import { PlayerFlight } from './PlayerFlight';
import { PlayerAnimationController } from './PlayerAnimationController';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';

const { ccclass, property } = _decorator;

const G_CLOUD = 'Obstacle · Electric cloud';
const G_WALL = 'Obstacle · Tower wall';

/**
 * Реакции на препятствия: все числа и тайминги задаются здесь (две группы в инспекторе).
 * Скрипты на препятствиях только ловят контакт и вызывают applyElectricCloudHit / applyTowerWallHit.
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({
        group: G_CLOUD,
        displayName: 'Lift lock (s)',
        tooltip:
            'Блокировка подъёма (flap) после контакта с облаком.',
    })
    electricDefaultLiftLockDuration = 0.5;

    @property({
        group: G_CLOUD,
        displayName: 'Cooldown (s)',
        tooltip:
            'Минимум между повторными срабатываниями одного и того же коллайдера облака.',
    })
    electricCloudCooldownSeconds = 0.55;

    @property({
        group: G_WALL,
        displayName: 'Knockback duration (s)',
        tooltip: 'Сколько секунд идёт отдача мира назад.',
    })
    towerWallKnockbackDurationSec = 0.55;

    @property({
        group: G_WALL,
        displayName: 'Knockback speed (px/s)',
        tooltip:
            'Модуль скорости сдвига чанков при отдаче (положительное число).',
    })
    towerWallKnockbackHorizontalPxPerSec = 280;

    @property({
        group: G_WALL,
        displayName: 'Downward impulse',
        tooltip:
            'Импульс вниз по физике при ударе; 0 — только гравитация.',
    })
    towerWallDownwardImpulse = 0;

    @property({
        group: G_WALL,
        displayName: 'Wall hit clip duration (s)',
        tooltip:
            'Сколько секунд показывается анимация удара. Если 0 — берётся то же время, что и «Knockback duration».',
    })
    towerWallHitAnimationDurationSec = 0;

    @property({
        group: G_WALL,
        displayName: 'Lift lock (s)',
        tooltip: 'Блок подъёма после удара; 0 — без блока.',
    })
    towerWallDefaultLiftLockDuration = 0.45;

    @property({
        group: G_WALL,
        displayName: 'Cooldown (s)',
        tooltip: 'Минимум между повторными срабатываниями одной и той же стены.',
    })
    towerWallCooldownSeconds = 0.65;

    private _flight: PlayerFlight | null = null;
    private _anim: PlayerAnimationController | null = null;

    onLoad() {
        this._flight =
            this.getComponent(PlayerFlight) ??
            this.node.parent?.getComponent(PlayerFlight) ??
            null;
        this._anim =
            this.getComponent(PlayerAnimationController) ??
            this.getComponentInChildren(PlayerAnimationController);
    }

    /**
     * Электрооблако: блок подъёма и анимация — параметры из группы «Electric cloud».
     */
    applyElectricCloudHit(): void {
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }
        gm.takeDamage(1, false);
        SoundController.instance?.play(SoundId.ElectricHit);
        const t = this.electricDefaultLiftLockDuration;
        if (t <= 0) {
            return;
        }
        this._flight?.setElectricLiftBlockedFor(t);
        this._anim?.notifyElectricDamage(t);
    }

    /**
     * Стена башни: отдача мира, импульс вниз, клип Wall Hit, блок подъёма — из группы «Tower wall».
     */
    applyTowerWallHit(): void {
        const gm = GameManager.game;
        if (!gm?.isPlaying) {
            return;
        }
        gm.takeDamage(1, false);
        SoundController.instance?.play(SoundId.WallHit);
        const kd = this.towerWallKnockbackDurationSec;
        if (kd <= 0) {
            return;
        }
        this._flight?.applyTowerKnockback(
            kd,
            this.towerWallKnockbackHorizontalPxPerSec,
            this.towerWallDownwardImpulse,
        );
        const animDur =
            this.towerWallHitAnimationDurationSec > 0
                ? this.towerWallHitAnimationDurationSec
                : kd;
        this._anim?.notifyWallHit(animDur);

        const lift = this.towerWallDefaultLiftLockDuration;
        if (lift > 0) {
            this._flight?.setElectricLiftBlockedFor(lift);
        }
    }

    /** Walk ancestors from a collider / child node until PlayerController is found. */
    public static findFromColliderNode(start: Node | null): PlayerController | null {
        let n: Node | null = start;
        while (n) {
            const ctrl = n.getComponent(PlayerController);
            if (ctrl) {
                return ctrl;
            }
            n = n.parent;
        }
        return null;
    }
}
