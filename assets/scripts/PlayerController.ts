import { _decorator, Component, Node } from 'cc';
import type { PlayerFlight } from './PlayerFlight';
import { GameSession, PLAYER_FLIGHT_CCLASS } from './GameSession';
import {
    forEachPlayerAnimController,
    PlayerAnimationController,
} from './PlayerAnimationController';
import { SoundController } from './SoundController';
import { SoundId } from './SoundLibrary';

const { ccclass, property } = _decorator;

const G_DAMAGE = { id: 'Damage', name: 'Damage' };
const G_CLOUD = { id: 'ElectricCloud', name: 'Electric cloud' };
const G_WALL = { id: 'TowerWall', name: 'Tower wall' };

/**
 * Реакции игрока на урон и препятствия: все числа и тайминги задаются здесь.
 * Скрипты на препятствиях только ловят контакт и вызывают applyElectricCloudHit / applyTowerWallHit.
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({
        group: G_DAMAGE,
        displayName: 'Damage invincibility (s)',
        tooltip:
            'После потери HP игрок не получает урон повторно, пока не истечёт таймер.',
    })
    damageInvincibilitySec = 3;

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
    electricCloudCooldownSeconds = 4;

    @property({
        group: G_WALL,
        displayName: 'Knockback duration (s)',
        tooltip: 'Сколько секунд идёт отдача мира назад.',
    })
    towerWallKnockbackDurationSec = 0.7;

    @property({
        group: G_WALL,
        displayName: 'Knockback speed (px/s)',
        tooltip:
            'Модуль скорости сдвига чанков при отдаче (положительное число).',
    })
    towerWallKnockbackHorizontalPxPerSec = 1300;

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
    towerWallHitAnimationDurationSec = 0.7;

    @property({
        group: G_WALL,
        displayName: 'Lift lock (s)',
        tooltip: 'Блок подъёма после удара; 0 — без блока.',
    })
    towerWallDefaultLiftLockDuration = 0.7;

    @property({
        group: G_WALL,
        displayName: 'Cooldown (s)',
        tooltip: 'Минимум между повторными срабатываниями одной и той же стены.',
    })
    towerWallCooldownSeconds = 0.5;

    private _flight: PlayerFlight | null = null;
    onLoad() {
        this._flight =
            (this.getComponent(PLAYER_FLIGHT_CCLASS) as PlayerFlight | null) ??
            (this.node.parent?.getComponent(
                PLAYER_FLIGHT_CCLASS,
            ) as PlayerFlight | null) ??
            null;
    }

    private _forEachAnim(fn: (a: PlayerAnimationController) => void): void {
        forEachPlayerAnimController(this.node, fn);
    }

    /**
     * Электрооблако: блок подъёма и анимация — параметры из группы «Electric cloud».
     */
    applyElectricCloudHit(): void {
        const gm = GameSession.game;
        if (!gm?.isPlaying) {
            return;
        }
        const lethal = gm.takeDamage(1, false, true, this.damageInvincibilitySec, {
            helmetProtects: false,
        });
        SoundController.instance?.play(SoundId.ElectricHit);

        const liftLock = Math.max(0, this.electricDefaultLiftLockDuration);
        /** Клип FediaFlashDamage ≈ 0.7 s — показываем даже при lift lock = 0 в инспекторе. */
        const animSec = liftLock > 0 ? liftLock : 0.7;

        if (lethal) {
            if (liftLock > 0) {
                this._flight?.setElectricLiftBlockedFor(liftLock);
            }
            if (animSec > 0) {
                this._forEachAnim((a) => a.notifyElectricDamage(animSec));
                gm.scheduleDeathAfterHazardAnimation(animSec);
            } else {
                gm.beginDeathSequence();
            }
            return;
        }

        if (liftLock > 0) {
            this._flight?.setElectricLiftBlockedFor(liftLock);
            this._flight?.allowHorizontalDriftFor(liftLock);
        }
        if (animSec > 0) {
            this._forEachAnim((a) => a.notifyElectricDamage(animSec));
        }
    }

    /**
     * Стена башни: отдача мира, импульс вниз, клип Wall Hit, блок подъёма — из группы «Tower wall».
     */
    applyTowerWallHit(): void {
        const gm = GameSession.game;
        if (!gm?.isPlaying) {
            return;
        }
        const lethal = gm.takeDamage(1, false, true, this.damageInvincibilitySec, {
            helmetProtects: true,
        });
        SoundController.instance?.play(SoundId.WallHit);
        const kd = this.towerWallKnockbackDurationSec;
        if (lethal) {
            if (kd > 0) {
                this._flight?.applyTowerKnockback(
                    kd,
                    this.towerWallKnockbackHorizontalPxPerSec,
                    this.towerWallDownwardImpulse,
                );
                const animDur =
                    this.towerWallHitAnimationDurationSec > 0
                        ? this.towerWallHitAnimationDurationSec
                        : kd;
                this._forEachAnim((a) => a.notifyWallHit(animDur));
                this._flight?.allowHorizontalDriftFor(
                    Math.max(kd, animDur, this.towerWallDefaultLiftLockDuration),
                );
                const lift = this.towerWallDefaultLiftLockDuration;
                if (lift > 0) {
                    this._flight?.setElectricLiftBlockedFor(lift);
                }
                gm.scheduleDeathAfterHazardAnimation(animDur);
            } else {
                gm.beginDeathSequence();
            }
            return;
        }
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
        this._forEachAnim((a) => a.notifyWallHit(animDur));
        this._flight?.allowHorizontalDriftFor(
            Math.max(kd, animDur, this.towerWallDefaultLiftLockDuration),
        );

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
