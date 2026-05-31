import type { GameManager } from './GameManager';

/** ccclass PlayerFlight — доступ без import PlayerFlight (нет цикла с GameManager). */
export const PLAYER_FLIGHT_CCLASS = 'PlayerFlight';

/** ccclass PlayerController — addComponent без import. */
export const PLAYER_CONTROLLER_CCLASS = 'PlayerController';

/**
 * Регистр активного GameManager для скриптов игрока/мира.
 * GameManager.bind при onLoad; PlayerFlight/PlayerController читают game отсюда.
 */
export class GameSession {
    private static _game: GameManager | null = null;

    public static get game(): GameManager | null {
        return GameSession._game;
    }

    public static bind(game: GameManager | null): void {
        GameSession._game = game;
    }
}
