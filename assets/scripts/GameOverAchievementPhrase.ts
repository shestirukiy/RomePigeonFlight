import { _decorator, CCString, Component, Label, RichText } from 'cc';

const { ccclass, property } = _decorator;

const G_TIERS = { id: 'Tiers', name: 'Phrase tiers' };

/** Порог метров + список фраз для одного уровня достижения. */
@ccclass('GameOverPhraseTier')
export class GameOverPhraseTier {
    @property({
        displayName: 'Min Meters',
        tooltip:
            'Игрок должен пройти ≥ этого числа метров (последняя веха), чтобы брать фразу из этого списка.',
    })
    minMeters = 0;

    @property({
        type: [CCString],
        displayName: 'Phrases',
        tooltip: 'Случайная строка из списка при game over.',
    })
    phrases: string[] = [];
}

/**
 * Комментарий к достижению на Game Over: три уровня (слабый / средний / крутой)
 * по порогу метров и случайная фраза из нужного массива.
 */
@ccclass('GameOverAchievementPhrase')
export class GameOverAchievementPhrase extends Component {
    @property({
        type: Label,
        displayName: 'Label',
        tooltip:
            'Label на Game Over. Пусто — ищется Label/RichText на этой ноде или в детях.',
    })
    label: Label | null = null;

    @property({
        group: G_TIERS,
        type: GameOverPhraseTier,
        displayName: 'Poor Achievement',
        tooltip: 'Низкий порог (часто 0 м) — самый слабый результат.',
    })
    poorTier = new GameOverPhraseTier();

    @property({
        group: G_TIERS,
        type: GameOverPhraseTier,
        displayName: 'Medium Achievement',
    })
    mediumTier = new GameOverPhraseTier();

    @property({
        group: G_TIERS,
        type: GameOverPhraseTier,
        displayName: 'Great Achievement',
        tooltip: 'Высокий порог — лучший результат.',
    })
    greatTier = new GameOverPhraseTier();

    @property({
        displayName: 'Fallback Phrase',
        tooltip: 'Если нет подходящего тира или список фраз пуст.',
    })
    fallbackPhrase = 'Keep flying!';

    /** Обновить текст по пройденным метрам (последняя пройденная веха). */
    public refreshForMeters(meters: number): void {
        const text = this._pickPhraseForMeters(meters);
        this._setText(text);
    }

    public clearPhrase(): void {
        this._setText('');
    }

    private _pickPhraseForMeters(meters: number): string {
        const m = Math.max(0, Math.floor(meters));
        const tier = this._resolveTier(m);
        if (!tier) {
            return this.fallbackPhrase;
        }

        const pool = tier.phrases
            .map((s) => s?.trim())
            .filter((s) => s.length > 0);
        if (pool.length === 0) {
            return this.fallbackPhrase;
        }

        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Тир с наибольшим minMeters, для которого meters >= порога. */
    private _resolveTier(meters: number): GameOverPhraseTier | null {
        const tiers = [this.poorTier, this.mediumTier, this.greatTier];
        let best: GameOverPhraseTier | null = null;
        let bestThreshold = -1;

        for (const tier of tiers) {
            if (!tier) {
                continue;
            }
            const threshold = Math.max(0, Math.floor(tier.minMeters));
            if (meters >= threshold && threshold >= bestThreshold) {
                best = tier;
                bestThreshold = threshold;
            }
        }

        return best;
    }

    private _setText(text: string): void {
        this._resolveLabel();
        if (this.label?.isValid) {
            this.label.string = text;
            return;
        }

        const rich =
            this.getComponent(RichText) ??
            this.getComponentInChildren(RichText);
        if (rich?.isValid) {
            rich.string = text;
        }
    }

    private _resolveLabel(): void {
        if (this.label?.isValid) {
            return;
        }
        this.label =
            this.getComponent(Label) ?? this.getComponentInChildren(Label);
    }
}
