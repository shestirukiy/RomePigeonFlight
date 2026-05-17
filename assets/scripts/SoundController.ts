import {
    _decorator,
    AudioClip,
    AudioSource,
    Component,
    Node,
} from 'cc';
import { SoundId, SoundLibrary } from './SoundLibrary';

const { ccclass, property } = _decorator;

const G_VOL = { id: 'Volume', name: 'Volume' };

/**
 * Воспроизведение SFX/музыки. Клипы — в SoundLibrary.
 * На Canvas: SoundLibrary + SoundController (можно на одном узле).
 */
@ccclass('SoundController')
export class SoundController extends Component {
    private static _inst: SoundController | null = null;

    public static get instance(): SoundController | null {
        return SoundController._inst;
    }

    @property({
        type: SoundLibrary,
        displayName: 'Sound Library',
        tooltip:
            'Компонент с клипами. Если пусто — ищется на этом узле и у детей.',
    })
    library: SoundLibrary | null = null;

    @property({
        displayName: 'SFX Pool Size',
        tooltip: 'Сколько AudioSource для одновременных коротких звуков.',
    })
    sfxPoolSize = 8;

    @property({
        group: G_VOL,
        displayName: 'SFX Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
    })
    sfxVolume = 1;

    @property({
        group: G_VOL,
        displayName: 'Wing Flap Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'Громкость взмахов крыльев (умножается на SFX Volume).',
    })
    wingFlapVolume = 1;

    @property({
        group: G_VOL,
        displayName: 'Seed Collect Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'Громкость сбора семечек (умножается на SFX Volume).',
    })
    seedCollectVolume = 1;

    @property({
        group: G_VOL,
        displayName: 'Music Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
    })
    musicVolume = 0.65;

    @property({ displayName: 'SFX Enabled' })
    sfxEnabled = true;

    @property({ displayName: 'Music Enabled' })
    musicEnabled = true;

    @property({
        displayName: 'Play BGM On Start',
        tooltip: 'Запустить bgmLoop из библиотеки при старте сцены.',
    })
    playBgmOnStart = false;

    private readonly _sfxPool: AudioSource[] = [];
    private _musicSource: AudioSource | null = null;
    private _poolCursor = 0;

    /** Самый первый тап за сессию (до перезагрузки страницы). */
    private _sessionFirstTapUsed = false;
    /** Не играть wing flap на том же тапе, что стартует забег. */
    private _suppressWingFlapOnce = false;

    onLoad() {
        SoundController._inst = this;
        this._resolveLibrary();
        this._buildSfxPool();
        this._ensureMusicSource();
    }

    start() {
        if (this.playBgmOnStart) {
            this.playBgm();
        }
    }

    onDestroy() {
        if (SoundController._inst === this) {
            SoundController._inst = null;
        }
    }

    /** Короткий звук (перекрывающиеся выстрелы/сбор). */
    public play(id: SoundId, volumeScale = 1): void {
        if (!this.sfxEnabled || id === SoundId.None) {
            return;
        }
        const clip = this.library?.getClip(id);
        if (!clip) {
            return;
        }
        const src = this._acquireSfxSource();
        if (!src) {
            return;
        }
        const vol = this._calcSfxVolume(id, volumeScale);
        src.playOneShot(clip, vol);
    }

    /** Сброс ротации вариантов (семечки, крылья) при новом забеге. */
    public resetVariantRotation(): void {
        this.library?.resetVariantRotation();
    }

    /**
     * Старт забега по тапу: первый тап сессии — Session First Tap, дальше — Tap Start.
     * Подавляет wing flap на этом же нажатии.
     */
    public playRunStartTap(): void {
        this._suppressWingFlapOnce = true;
        if (!this._sessionFirstTapUsed) {
            this._sessionFirstTapUsed = true;
            this.play(SoundId.SessionFirstTap);
            if (this.library?.sessionFirstTap) {
                return;
            }
        }
        this.play(SoundId.TapStart);
    }

    /** Один раз на нажатие: взмах крыльев (во время полёта, если подъём доступен). */
    public tryPlayWingFlap(): void {
        if (this._suppressWingFlapOnce) {
            this._suppressWingFlapOnce = false;
            return;
        }
        this.playClip(
            this.library?.pickWingFlapClip() ?? null,
            this.wingFlapVolume,
        );
    }

    /** Произвольный клип; categoryVolume — как wingFlapVolume / seedCollectVolume. */
    public playClip(
        clip: AudioClip | null,
        categoryVolume = 1,
        extraScale = 1,
    ): void {
        if (!this.sfxEnabled || !clip) {
            return;
        }
        const src = this._acquireSfxSource();
        if (!src) {
            return;
        }
        src.playOneShot(
            clip,
            Math.max(0, this.sfxVolume * categoryVolume * extraScale),
        );
    }

    public playSeedCollect(): void {
        this.play(SoundId.SeedCollect);
    }

    private _calcSfxVolume(id: SoundId, extraScale = 1): number {
        let category = 1;
        if (id === SoundId.SeedCollect) {
            category = this.seedCollectVolume;
        } else if (id === SoundId.WingFlap) {
            category = this.wingFlapVolume;
        }
        return Math.max(0, this.sfxVolume * category * extraScale);
    }

    public playBgm(loop = true): void {
        if (!this.musicEnabled || !this._musicSource) {
            return;
        }
        const clip = this.library?.bgmLoop;
        if (!clip) {
            return;
        }
        this._musicSource.stop();
        this._musicSource.clip = clip;
        this._musicSource.loop = loop;
        this._musicSource.volume = this.musicVolume;
        this._musicSource.play();
    }

    public stopBgm(): void {
        this._musicSource?.stop();
    }

    public setSfxEnabled(on: boolean): void {
        this.sfxEnabled = on;
    }

    public setMusicEnabled(on: boolean): void {
        this.musicEnabled = on;
        if (!on) {
            this.stopBgm();
        } else if (this.playBgmOnStart) {
            this.playBgm();
        }
    }

    private _resolveLibrary(): void {
        if (this.library?.isValid) {
            return;
        }
        this.library =
            this.getComponent(SoundLibrary) ??
            this.getComponentInChildren(SoundLibrary);
    }

    private _buildSfxPool(): void {
        this._sfxPool.length = 0;
        const n = Math.max(1, Math.floor(this.sfxPoolSize));
        for (let i = 0; i < n; i++) {
            const child = new Node(`SFX_${i}`);
            child.parent = this.node;
            const src = child.addComponent(AudioSource);
            src.playOnAwake = false;
            this._sfxPool.push(src);
        }
    }

    private _ensureMusicSource(): void {
        let musicNode = this.node.getChildByName('Music');
        if (!musicNode) {
            musicNode = new Node('Music');
            musicNode.parent = this.node;
        }
        this._musicSource =
            musicNode.getComponent(AudioSource) ??
            musicNode.addComponent(AudioSource);
        this._musicSource.playOnAwake = false;
    }

    private _acquireSfxSource(): AudioSource | null {
        if (this._sfxPool.length === 0) {
            return null;
        }
        const src = this._sfxPool[this._poolCursor % this._sfxPool.length];
        this._poolCursor = (this._poolCursor + 1) % this._sfxPool.length;
        return src;
    }
}
