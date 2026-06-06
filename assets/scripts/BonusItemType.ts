import { ccenum } from 'cc';

/** Типы бонусов для BonusItemScheduler (без импортов из игровых скриптов — без циклов). */
export enum BonusItemType {
    Life = 0,
    Helmet = 1,
    Magnet = 2,
    Wisdom = 3,
}

ccenum(BonusItemType);
