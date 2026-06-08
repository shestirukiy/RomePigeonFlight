import {
    _decorator,
    AudioClip,
    AudioSource,
    Component,
    Node,
    tween,
    Tween,
} from 'cc';
import { MusicTrack, SoundId, SoundLibrary } from './SoundLibrary';

const { ccclass, property } = _decorator;

const G_VOL = { id: 'Volume', name: 'Volume' };
const G_MUSIC_VOL = { id: 'MusicVolume', name: 'Music volume' };

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
        displayName: 'Milestone Passed Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'Звук прохождения столба-вехи (× SFX Volume).',
    })
    milestonePassedVolume = 1;

    @property({
        group: G_VOL,
        displayName: 'Speed Boost Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'Звук ускорения после вехи (× SFX Volume).',
    })
    speedBoostVolume = 1;

    @property({
        group: G_MUSIC_VOL,
        displayName: 'Menu BGM Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'BGM · Waiting (ожидание тапа) и BGM · KTA (панель после поражения).',
    })
    menuMusicVolume = 0.65;

    @property({
        group: G_MUSIC_VOL,
        displayName: 'Gameplay BGM Volume',
        slide: true,
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: 'BGM · Gameplay во время активного забега.',
    })
    gameplayMusicVolume = 0.65;

    @property({
        group: G_VOL,
        displayName: 'Music Crossfade (s)',
        slide: true,
        min: 0,
        max: 5,
        step: 0.05,
        tooltip:
            'Плавный переход между BGM (Waiting → Gameplay и др.). 0 — мгновенная смена.',
    })
    musicCrossfadeDurationSec = 1.5;

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
    private _musicAltSource: AudioSource | null = null;
    private _musicCrossfadeTween: Tween<{ t: number }> | null = null;

    /** Узел Music для ENDED; в onDestroy node у AudioSource уже может быть null. */
    private _musicEventNode: Node | null = null;

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
        this._cancelMusicCrossfade();
        this._unbindMusicEnded();
        this._musicSource = null;
        this._musicAltSource = null;
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

    /**
     * Клип на отдельном AudioSource до ENDED — не режется SFX-пулом (playOneShot).
     * Для длинных/важных one-shot (touch trigger, реплики).
     */
    public playClipToCompletion(
        clip: AudioClip | null,
        categoryVolume = 1,
        extraScale = 1,
    ): void {
        if (!this.sfxEnabled || !clip) {
            return;
        }
        const vol = Math.max(0, this.sfxVolume * categoryVolume * extraScale);
        const child = new Node('SFX_Complete');
        child.parent = this.node;
        const src = child.addComponent(AudioSource);
        src.playOnAwake = false;
        src.clip = clip;
        src.loop = false;
        src.volume = vol;
        src.play();

        let cleaned = false;
        const cleanup = (): void => {
            if (cleaned) {
                return;
            }
            cleaned = true;
            this.unschedule(fallbackCleanup);
            if (child.isValid) {
                child.destroy();
            }
        };
        const fallbackCleanup = (): void => cleanup();
        child.once(AudioSource.EventType.ENDED, cleanup, this);
        const dur = clip.getDuration();
        if (dur > 0) {
            this.scheduleOnce(fallbackCleanup, dur + 0.15);
        }
    }

    public playSeedCollect(): void {
        this.play(SoundId.SeedCollect);
    }

    /** Пролёт столба-вехи. */
    public playMilestonePassed(): void {
        this.play(SoundId.MilestonePassed);
    }

    /** Pass Boost после вехи. */
    public playSpeedBoost(): void {
        this.play(SoundId.SpeedBoost);
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
        } else if (id === SoundId.MilestonePassed) {
            category = this.milestonePassedVolume;
        } else if (id === SoundId.SpeedBoost) {
            category = this.speedBoostVolume;
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
        if (!this._musicSource || !this._musicAltSource) {
            return;
        }
        if (!this.musicEnabled) {
            this.stopBgm();
            return;
        }

        const clip = this._clipForMusicTrack(track);
        if (!clip) {
            if (this._currentMusic !== track) {
                this._cancelMusicCrossfade();
                this._musicSource.stop();
                this._musicAltSource.stop();
                this._currentMusic = null;
            }
            return;
        }

        const out = this._musicSource;
        const sameTrack =
            this._currentMusic === track && out.clip === clip;

        if (sameTrack && out.playing) {
            if (!forceRestart) {
                return;
            }
        }

        const fadeSec = Math.max(0, this.musicCrossfadeDurationSec);
        const canCrossfade = fadeSec > 0 && out.playing;
        if (!canCrossfade) {
            this._playMusicInstant(track, clip, loop);
            return;
        }

        this._crossfadeMusic(track, clip, loop, out, this._musicAltSource, fadeSec);
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
        this._cancelMusicCrossfade();
        this._musicSource?.stop();
        this._musicAltSource?.stop();
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

    /** Громкость BGM по фазе (× Music Enabled). */
    private _musicVolumeForTrack(track: MusicTrack): number {
        if (!this.musicEnabled) {
            return 0;
        }
        switch (track) {
            case MusicTrack.Gameplay:
                return Math.max(0, this.gameplayMusicVolume);
            case MusicTrack.Waiting:
            case MusicTrack.Kta:
            default:
                return Math.max(0, this.menuMusicVolume);
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
        this._musicSource = this._getOrCreateMusicSource('Music');
        this._musicAltSource = this._getOrCreateMusicSource('MusicB');
    }

    private _getOrCreateMusicSource(nodeName: string): AudioSource {
        let musicNode = this.node.getChildByName(nodeName);
        if (!musicNode) {
            musicNode = new Node(nodeName);
            musicNode.parent = this.node;
        }
        const src =
            musicNode.getComponent(AudioSource) ??
            musicNode.addComponent(AudioSource);
        src.playOnAwake = false;
        return src;
    }

    private _playMusicInstant(
        track: MusicTrack,
        clip: AudioClip,
        loop: boolean,
    ): void {
        this._cancelMusicCrossfade();
        const out = this._musicSource;
        const alt = this._musicAltSource;
        if (!out || !alt) {
            return;
        }
        alt.stop();
        out.stop();
        out.clip = clip;
        out.loop = loop;
        out.volume = this._musicVolumeForTrack(track);
        out.play();
        this._currentMusic = track;
        this._bindMusicEnded();
    }

    private _crossfadeMusic(
        track: MusicTrack,
        clip: AudioClip,
        loop: boolean,
        out: AudioSource,
        inn: AudioSource,
        durationSec: number,
    ): void {
        this._cancelMusicCrossfade();

        inn.stop();
        inn.clip = clip;
        inn.loop = loop;
        inn.volume = 0;
        inn.play();

        const targetVol = this._musicVolumeForTrack(track);
        const prevTrack = this._currentMusic;
        const startOutVol = out.playing ? out.volume : 0;
        const state = { t: 0 };

        this._musicCrossfadeTween = tween(state)
            .to(
                durationSec,
                { t: 1 },
                {
                    easing: 'sineInOut',
                    onUpdate: () => {
                        const t = state.t;
                        if (out.playing) {
                            out.volume = startOutVol * (1 - t);
                        }
                        inn.volume = targetVol * t;
                    },
                },
            )
            .call(() => {
                this._musicCrossfadeTween = null;
                out.stop();
                out.volume =
                    prevTrack != null
                        ? this._musicVolumeForTrack(prevTrack)
                        : targetVol;
                inn.volume = targetVol;
                this._musicSource = inn;
                this._musicAltSource = out;
                this._currentMusic = track;
                this._bindMusicEnded();
            })
            .start();
    }

    private _cancelMusicCrossfade(): void {
        if (this._musicCrossfadeTween) {
            this._musicCrossfadeTween.stop();
            this._musicCrossfadeTween = null;
        }
    }

    private _bindMusicEnded(): void {
        this._unbindMusicEnded();
        const node = this._musicSource?.node;
        if (!node?.isValid) {
            return;
        }
        this._musicEventNode = node;
        node.on(AudioSource.EventType.ENDED, this._onMusicEnded, this);
    }

    private _unbindMusicEnded(): void {
        const node = this._musicEventNode;
        this._musicEventNode = null;
        if (!node?.isValid) {
            return;
        }
        node.off(AudioSource.EventType.ENDED, this._onMusicEnded, this);
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
