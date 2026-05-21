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
2. В **Bonus Weighted Chunks** добавьте префабы с весами (weight > 0). После каждой вехи идёт **следующий по кругу** (0→1→2→3→0), не случайный endless.
3. **Не** дублируйте те же префабы в **Endless Weighted** — иначе после бонуса снова может идти тот же чанк из endless (например Chunk_1Cloud).
4. Бонусные чанки, как и столб вехи, **не смещаются по Y** (`Obstacle Chunk Vertical Offset` на них не действует).

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

Столб появляется, когда **пройдена дистанция порога** на слое препятствий (Plane 1 × **Plane 1 Parallax Factor**). После порога игра ставит столб при **ближайшем ресайкле** левого сегмента, который уже **ушёл за левый край экрана** (как обычные чанки) — видимый чанк не сносится раньше времени.

**Milestone Speed Multiplier** — ускорение мира за каждый **пройденный** столб (`scrollSpeed × multiplier^N`, без cap).

**Pass Boost** после столба — краткий ×2 к скорости: от 50 до 100 по времени часто **короче**, чем от старта до 50, даже при одинаковых 50 м на табличке.

`First Milestone = 0` — вехи отключены.

### Почему «до 50 — долго, до 100 — быстро»

1. **Раньше** столб мог появиться только при следующем ресайкле — цифра «50» визуально запаздывала.
2. **После 50** включаются множитель скорости вехи и Pass Boost — те же метры пролетаются быстрее.
3. **Pixels Per Meter** в сцене (например 400) при **Scroll Speed** 500 даёт ~40 с до первого порога; уменьшите ppm или first, если рано.
4. Зазоры **растут**: gap(1)=base+growth, gap(2)=base+growth×2^exp… — между 100 и 200 м уже больше, чем между 50 и 100.

### Баланс

- Ранний run: уменьшите **First**, **Gap Base** или **Pixels Per Meter**.
- Слишком жёстко на дистанции: увеличьте **Gap Growth** / **Gap Exponent**.
- Слишком быстро по реакции: снизьте **Milestone Speed Multiplier** (например 1.03) и/или **Pass Boost Multiplier**.
