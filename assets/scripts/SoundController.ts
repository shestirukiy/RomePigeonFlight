import {
    _decorator,
    AudioClip,
    AudioSource,
    Component,
    Node,
} from 'cc';
import { MusicTrack, SoundId, SoundLibrary } from './SoundLibrary';

const { ccclass, property } = _decorator;

const G_VOL = { id: 'Volume', name: 'Volume' };

export { MusicTrack };

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
        max: 3,
        step: 0.05,
        tooltip:
            'Громкость взмаха (× SFX Volume). Значения > 1 усиливают клип громче оригинала (до ~3×).',
    })
    wingFlapVolume = 1.25;

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
        displayName: 'Play Waiting Music On Start',
        tooltip:
            'При старте сцены — BGM · Waiting (пока игрок не начал забег).',
    })
    playWaitingMusicOnStart = true;

    private readonly _sfxPool: AudioSource[] = [];
    private _musicSource: AudioSource | null = null;
    private _poolCursor = 0;
    private _currentMusic: MusicTrack | null = null;

    /** BGM · Gameplay на KTA (рестарт по концу трека, пока активна эта фаза). */
    private _ktaBgmActive = false;

    /** Самый первый тап за сессию (до перезагрузки страницы). */
    private _sessionFirstTapUsed = false;
    /** Не играть wing flap на том же тапе, что стартует забег. */
    private _suppressWingFlapOnce = false;

    onLoad() {
        SoundController._inst = this;
        this._resolveLibrary();
        this._buildSfxPool();
        this._ensureMusicSource();
        this._bindMusicEnded();
    }

    start() {
        if (this.playWaitingMusicOnStart) {
            this.playMusicWaiting();
        }
    }

    onDestroy() {
        this._unbindMusicEnded();
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
        const vol = Math.max(0, this.sfxVolume * categoryVolume * extraScale);
        src.playOneShot(clip, vol);
    }

    public playSeedCollect(): void {
        this.play(SoundId.SeedCollect);
    }

    /** Однократный джингл поражения (отдельно от BGM-канала). */
    public playGameOverJingle(): void {
        const clip = this.library?.getClip(SoundId.GameOver);
        if (!clip) {
            return;
        }
        this.playClip(clip, 1);
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

    /**
     * @param forceRestart true — с начала (проигрыш / конец трека); false — не перезапускать, если уже играет.
     */
    public playMusic(
        track: MusicTrack,
        loop = true,
        forceRestart = false,
    ): void {
        if (!this._musicSource) {
            return;
        }
        if (!this.musicEnabled) {
            this.stopBgm();
            return;
        }

        const clip = this._clipForMusicTrack(track);
        if (!clip) {
            if (this._currentMusic !== track) {
                this._musicSource.stop();
                this._currentMusic = null;
            }
            return;
        }

        const sameTrack =
            this._currentMusic === track && this._musicSource.clip === clip;

        if (sameTrack && this._musicSource.playing) {
            if (!forceRestart) {
                return;
            }
            this._musicSource.stop();
            this._musicSource.clip = clip;
            this._musicSource.loop = loop;
            this._musicSource.volume = this.musicVolume;
            this._musicSource.play();
            this._currentMusic = track;
            return;
        }

        this._musicSource.stop();
        this._musicSource.clip = clip;
        this._musicSource.loop = loop;
        this._musicSource.volume = this.musicVolume;
        this._musicSource.play();
        this._currentMusic = track;
    }

    /** KTA: отдельный BGM (не gameplay); с начала при открытии панели. */
    public playMusicForKtaPanel(forceRestart = true): void {
        this._ktaBgmActive = true;
        this.playMusic(MusicTrack.Kta, true, forceRestart);
    }

    public endKtaBgmPhase(): void {
        this._ktaBgmActive = false;
    }

    /**
     * Play Again после KTA: не перезапускать и не менять на Waiting — трек идёт дальше.
     */
    public continueKtaMusicAfterPlayAgain(): void {
        this._ktaBgmActive = true;
        this.playMusic(MusicTrack.Kta, true, false);
    }

    /** Старт забега: BGM · Gameplay (зацикленно), конец фазы KTA. */
    public playMusicForNewRun(): void {
        this.endKtaBgmPhase();
        this.playMusic(MusicTrack.Gameplay, true, true);
    }

    public playMusicWaiting(loop = true, forceRestart = false): void {
        this.playMusic(MusicTrack.Waiting, loop, forceRestart);
    }

    public playMusicGameplay(loop = true, forceRestart = false): void {
        this.playMusic(MusicTrack.Gameplay, loop, forceRestart);
    }

    public stopBgm(): void {
        this._musicSource?.stop();
        this._currentMusic = null;
    }

    public setSfxEnabled(on: boolean): void {
        this.sfxEnabled = on;
    }

    public setMusicEnabled(on: boolean): void {
        this.musicEnabled = on;
        if (!on) {
            this.stopBgm();
        } else if (this._currentMusic !== null) {
            this.playMusic(this._currentMusic);
        } else if (this.playWaitingMusicOnStart) {
            this.playMusicWaiting();
        }
    }

    private _clipForMusicTrack(track: MusicTrack): AudioClip | null {
        return this.library?.getMusicClip(track) ?? null;
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

    private _bindMusicEnded(): void {
        if (!this._musicSource) {
            return;
        }
        this._musicSource.node.on(
            AudioSource.EventType.ENDED,
            this._onMusicEnded,
            this,
        );
    }

    private _unbindMusicEnded(): void {
        this._musicSource?.node.off(
            AudioSource.EventType.ENDED,
            this._onMusicEnded,
            this,
        );
    }

    private _onMusicEnded(): void {
        if (
            !this._ktaBgmActive ||
            this._currentMusic !== MusicTrack.Kta ||
            !this._musicSource?.loop
        ) {
            return;
        }
        this.playMusicForKtaPanel(true);
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
