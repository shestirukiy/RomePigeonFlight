# Milestone signs — привязка Label в редакторе

## Компонент `MilestoneDistanceLabel`

Перетащите **свой Label** в поле **Distance Label**. Метод `setMeters(n)` обновит текст.

## Chunk_Sign (в игре)

1. На корне `Chunk_Sign` добавьте **MilestoneDistanceLabel** → в **Distance Label** перетащите ваш Label.
2. На корне добавьте **MilestoneSign** → в **Distance Display** перетащите тот же **MilestoneDistanceLabel** (с этого узла).
3. **Pass Trigger** — по желанию свой коллайдер-сенсор; иначе создастся `PassTrigger` автоматически.
4. Не добавляйте Chunk_Sign в Endless Weighted — только через `LevelGenerator.milestoneSignPrefab`.
5. Бонусные чанки (семечки-награда) — только в **Bonus Weighted Chunks**, не в Endless.

## Sign (game over)

1. На префабе **Sign** (или инстансе в GameOverPanel) — **MilestoneDistanceLabel** + ваш Label.
2. На **Canvas → Scene Node Hub** в **Game Over Milestone Sign** перетащите этот **MilestoneDistanceLabel**.

## LevelGenerator / GameManager

- `milestoneSignPrefab` = Chunk_Sign  
- **Bonus chunks (после вехи)** — `bonusChunksAfterMilestone` + **Bonus Weighted Chunks** (например `Chunk_SeedHeart`, `Chunk_SeedWave` с `SeedPattern`).
- Пороги и ускорение — в **GameManager** (группа **Milestone signs**).

### Бонус после вехи

Порядок сегментов плана 1: **… → Chunk_Sign (веха) → бонусный чанк → обычный endless …**

1. В **LevelGenerator** включите **Bonus After Milestone**.
2. В **Bonus Weighted Chunks** добавьте префабы с весами (как в Endless Weighted).
3. Не дублируйте их в **Endless Weighted** — бонусы вставляются только сразу после столба.
4. Бонусные чанки, как и столб вехи, **не смещаются по Y** (`Obstacle Chunk Vertical Offset` на них не действует).
4. Бонусные чанки без случайного Y (как веха и стартовые чанки).

### Кривая порогов (внутри одного забега)

Столбы ставятся на **кумулятивные метры** дистанции полёта (на табличке те же числа), не через равный шаг 100 м.

| Поле | Смысл | Стартовый тюнинг |
|------|--------|------------------|
| **First Milestone (m)** | Первый порог | 50 |
| **Milestone Gap Base (m)** | `gap(0)` до второго столба | 50 → второй порог ≈ 100 м |
| **Milestone Gap Growth (m)** | прибавка к зазору | 35 |
| **Milestone Gap Exponent** | `gap(k) = base + growth × k^exp` | 1.35 |
| **Milestone Round Step (m)** | Цифры только кратные шагу (50 → …700, 750) | 50 |

Потолков нет: зазор и скорость растут сколько угодно; предел — только навык игрока.

Пример порогов: **50 → 100 → 185 → 310 → …** м (зазоры ~50, 85, 125… и дальше всё больше).

Столб появляется, когда **пройдена дистанция порога** и срабатывает ресайкл чанка плана 1 (не «каждый N-й чанк подряд»).

**Milestone Speed Multiplier** — ускорение мира за каждый **пройденный** столб (`scrollSpeed × multiplier^N`, без cap).

`First Milestone = 0` — вехи отключены.

### Баланс

- Ранний run: если столбы редковаты — уменьшите **First** или **Gap Base**.
- Слишком жёстко на дистанции: увеличьте **Gap Growth** / **Gap Exponent**.
- Слишком быстро по реакции: слегка снизьте **Milestone Speed Multiplier** (например 1.03).
