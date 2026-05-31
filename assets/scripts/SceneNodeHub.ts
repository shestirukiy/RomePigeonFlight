import {
    _decorator,
    Animation,
    Component,
    Label,
    Node,
    ParticleSystem2D,
    RichText,
    tween,
    Tween,
} from 'cc';
import { GameOverAchievementPhrase } from './GameOverAchievementPhrase';
import { MilestoneDistanceLabel } from './MilestoneDistanceLabel';

const { ccclass, property } = _decorator;

const G_PHRASES = { id: 'Phrases', name: 'Screen phrases' };

type PhraseSlot = 'life' | 'meters';

/**
 * Scene references on Canvas: UI root, player, view size root. Chunk prefabs live on LevelGenerator.
 */
@ccclass('SceneNodeHub')
export class SceneNodeHub extends Component {
    private static _inst: SceneNodeHub | null = null;

    public static get instance(): SceneNodeHub | null {
        return SceneNodeHub._inst;
    }

    @property({
        type: Node,
        displayName: 'Canvas Root',
        tooltip:
            'Корень UI. На Canvas можно не задавать — подставится сам Canvas (узел этого компонента).',
    })
    canvasRoot: Node | null = null;

    @property({
        type: Node,
        displayName: 'Player',
        tooltip: 'Узел игрока.',
    })
    player: Node | null = null;

    @property({
        type: Node,
        displayName: 'View Root',
        tooltip:
            'Ширина экрана (UITransform) для логики, которая от хаба читает размер. На Canvas можно не задавать.',
    })
    viewRoot: Node | null = null;

    @property({
        type: Node,
        displayName: 'Game Over Seed Score',
        tooltip: 'LabelScore на GameOverPanel — узел с числом семечек.',
    })
    gameOverSeedScoreNode: Node | null = null;

    @property({
        type: MilestoneDistanceLabel,
        displayName: 'Game Over Milestone Sign',
        tooltip:
            'MilestoneDistanceLabel на префабе Sign в Game Over: показывает последнюю пройденную веху (м).',
    })
    gameOverMilestoneSign: MilestoneDistanceLabel | null = null;

    @property({
        type: GameOverAchievementPhrase,
        displayName: 'Game Over Achievement Phrase',
        tooltip:
            'GameOverAchievementPhrase на Label комментария к метрам (три тира фраз).',
    })
    gameOverAchievementPhrase: GameOverAchievementPhrase | null = null;

    @property({
        type: ParticleSystem2D,
        displayName: 'Speed Lines Emitter',
        tooltip:
            'ParticleSystem2D на Canvas/Node/Particle2D. GameManager вкл/выкл эмиттер на Pass Boost.',
    })
    speedLinesEmitter: ParticleSystem2D | null = null;

    @property({
        group: G_PHRASES,
        type: Node,
        displayName: 'Life Restored Phrase Node',
        tooltip:
            'Нода с Label/RichText «+1 Life restored». Свой цвет и шрифт. Родители должны быть active.',
    })
    lifeRestoredPhraseNode: Node | null = null;

    @property({
        group: G_PHRASES,
        type: Node,
        displayName: 'Meters Passed Phrase Node',
        tooltip:
            'Нода с Label/RichText «Record: 100 METERS» после столба. Отдельный стиль от Life.',
    })
    metersPassedPhraseNode: Node | null = null;

    @property({
        group: G_PHRASES,
        displayName: 'Life Restored Text',
    })
    lifeRestoredText = '+1 Life restored';

    @property({
        group: G_PHRASES,
        displayName: 'Meters Phrase Format',
        tooltip:
            'Шаблон фразы метров: {0} — число, {1} — суффикс (Meters Suffix). Пример: Record: {0} {1}',
    })
    metersPhraseFormat = 'Record: {0} {1}';

    @property({
        group: G_PHRASES,
        displayName: 'Meters Suffix',
    })
    metersSuffix = 'METERS';

    @property({
        group: G_PHRASES,
        displayName: 'Phrase Display Duration (s)',
        tooltip: 'Скрыть фразу, если на ноде нет своего Animation-клипа.',
    })
    phraseDisplayDurationSec = 2.2;

    @property({
        group: G_PHRASES,
        displayName: 'Life Phrase Clip Name',
        tooltip: 'Animation на ноде Life — имя клипа. Пусто = pop scale.',
    })
    lifePhraseClipName = '';

    @property({
        group: G_PHRASES,
        displayName: 'Meters Phrase Clip Name',
        tooltip: 'Animation на ноде Meters — имя клипа. Пусто = pop scale.',
    })
    metersPhraseClipName = '';

    private _lifeTween: Tween<Node> | null = null;
    private _metersTween: Tween<Node> | null = null;

    onLoad() {
        SceneNodeHub._inst = this;
        if (!this.canvasRoot) {
            this.canvasRoot = this.node;
        }
        if (!this.viewRoot) {
            this.viewRoot = this.node;
        }
    }

    start() {
        this._hidePhrase('life');
        this._hidePhrase('meters');
    }

    onDestroy() {
        this._cancelLifeTween();
        this._cancelMetersTween();
        this.unschedule(this._hideLifeRestored);
        this.unschedule(this._hideMetersPassed);
        if (SceneNodeHub._inst === this) {
            SceneNodeHub._inst = null;
        }
    }

    /** +1 HP за порог семечек. */
    public showLifeRestored(customText?: string): void {
        const root = this.lifeRestoredPhraseNode;
        if (!this._setTextOnNode(root, customText ?? this.lifeRestoredText)) {
            console.warn(
                '[SceneNodeHub] Life Restored Phrase Node: нет Label/RichText или нода не задана.',
            );
            return;
        }
        this._showPhrase('life');
    }

    /** Пройден столб-веха. */
    public showMetersPassed(meters: number): void {
        const root = this.metersPassedPhraseNode;
        const m = Math.max(0, Math.floor(meters));
        const text = this.metersPhraseFormat
            .replace('{0}', String(m))
            .replace('{1}', this.metersSuffix);
        if (!this._setTextOnNode(root, text)) {
            console.warn(
                '[SceneNodeHub] Meters Passed Phrase Node: нет Label/RichText или нода не задана.',
            );
            return;
        }
        this._showPhrase('meters');
    }

    public hideAllPhrases(): void {
        this._hidePhrase('life');
        this._hidePhrase('meters');
    }

    /** Корень UI (хаб на Canvas = сам Canvas). */
    public get canvas(): Node {
        return this.canvasRoot ?? this.node;
    }

    private _phraseRoot(slot: PhraseSlot): Node | null {
        return slot === 'life'
            ? this.lifeRestoredPhraseNode
            : this.metersPassedPhraseNode;
    }

    private _clipName(slot: PhraseSlot): string {
        return slot === 'life'
            ? this.lifePhraseClipName.trim()
            : this.metersPhraseClipName.trim();
    }

    private _showPhrase(slot: PhraseSlot): void {
        const root = this._phraseRoot(slot);
        if (!root?.isValid) {
            return;
        }
        this._ensureActiveChain(root);

        if (slot === 'life') {
            this.unschedule(this._hideLifeRestored);
            this._cancelLifeTween();
        } else {
            this.unschedule(this._hideMetersPassed);
            this._cancelMetersTween();
        }

        const clip = this._clipName(slot);
        if (clip && this._playClipOnNode(root, clip)) {
            this._scheduleHide(slot, Math.max(0.1, this.phraseDisplayDurationSec));
            return;
        }

        this._playPlaceholderPop(root, slot);
        this._scheduleHide(slot, Math.max(0.1, this.phraseDisplayDurationSec));
    }

    private _hidePhrase(slot: PhraseSlot): void {
        const root = this._phraseRoot(slot);
        if (!root?.isValid) {
            return;
        }
        root.active = false;
    }

    private _setTextOnNode(root: Node | null, text: string): boolean {
        if (!root?.isValid) {
            return false;
        }
        const label =
            root.getComponent(Label) ?? root.getComponentInChildren(Label);
        if (label?.isValid) {
            label.string = text;
            return true;
        }
        const rich =
            root.getComponent(RichText) ??
            root.getComponentInChildren(RichText);
        if (rich?.isValid) {
            rich.string = text;
            return true;
        }
        return false;
    }

    private _ensureActiveChain(node: Node): void {
        let n: Node | null = node;
        while (n?.isValid) {
            if (!n.active) {
                n.active = true;
            }
            n = n.parent;
        }
        node.active = true;
    }

    private _playClipOnNode(root: Node, clipName: string): boolean {
        const anim =
            root.getComponent(Animation) ??
            root.getComponentInChildren(Animation);
        if (!anim?.isValid || !anim.getState(clipName)) {
            return false;
        }
        anim.play(clipName);
        return true;
    }

    private _playPlaceholderPop(root: Node, slot: PhraseSlot): void {
        const scale = root.scale.clone();
        root.setScale(scale.x * 0.85, scale.y * 0.85, scale.z);
        const tw = tween(root)
            .to(0.35, { scale }, { easing: 'backOut' })
            .start();
        if (slot === 'life') {
            this._lifeTween = tw;
        } else {
            this._metersTween = tw;
        }
    }

    private _scheduleHide(slot: PhraseSlot, sec: number): void {
        if (slot === 'life') {
            this.scheduleOnce(this._hideLifeRestored, sec);
        } else {
            this.scheduleOnce(this._hideMetersPassed, sec);
        }
    }

    private readonly _hideLifeRestored = () => {
        this._hidePhrase('life');
    };

    private readonly _hideMetersPassed = () => {
        this._hidePhrase('meters');
    };

    private _cancelLifeTween(): void {
        if (this._lifeTween) {
            this._lifeTween.stop();
            this._lifeTween = null;
        }
    }

    private _cancelMetersTween(): void {
        if (this._metersTween) {
            this._metersTween.stop();
            this._metersTween = null;
        }
    }
}
