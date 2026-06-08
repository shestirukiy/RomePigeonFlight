import { _decorator, Prefab } from 'cc';

const { ccclass, property } = _decorator;

/** Элемент пула бесконечных чанков: префаб + относительная частота выпадения. */
@ccclass('WeightedChunk')
export class WeightedChunk {
    @property({
        type: Prefab,
        displayName: 'Chunk Prefab',
        tooltip: 'Префаб сегмента уровня (корень с UITransform по ширине тайла).',
    })
    prefab: Prefab | null = null;

    @property({
        displayName: 'Weight',
        tooltip: 'Чем больше вес, тем чаще этот чанк среди бесконечной части.',
    })
    weight = 1;

    @property({
        displayName: 'Min Appear (m)',
        tooltip:
            'Endless: чанк попадает в случайный выбор только после этой дистанции забега. 0 — сразу.',
    })
    minAppearMeters = 0;
}
