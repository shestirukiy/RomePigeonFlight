import { _decorator, AudioClip, ccenum, Component } from 'cc';

const { ccclass, property } = _decorator;

/** Ключи звуков — enum в этом же файле, отдельный скрипт не нужен. */
export enum SoundId {
    None = 0,
    SeedCollect = 1,
    PickupCollect = 2,
    Damage = 3,
    ElectricHit = 4,
    WallHit = 5,
    InstantKill = 6,
    GameOver = 7,
    TapStart = 8,
    SessionFirstTap = 9,
    WingFlap = 10,
    /** Прохождение столба-вехи (сенсор MilestoneSign). */
    MilestonePassed = 11,
    /** Pass Boost — ускорение после вехи. */
    SpeedBoost = 12,
}

ccenum(SoundId);

/** Фоновая музыка по фазам сессии. */
export enum MusicTrack {
    Waiting = 0,
    Gameplay = 1,
    Kta = 2,
}

ccenum(MusicTrack);

const G_GAMEPLAY = { id: 'Gameplay', name: 'Gameplay' };
const G_PLAYER = { id: 'Player', name: 'Player' };
const G_UI = { id: 'UI', name: 'UI' };
const G_MUSIC = { id: 'Music', name: 'Music' };
const G_MILESTONE = { id: 'Milestone', name: 'Milestone & boost' };

/**
 * Каталог AudioClip для инспектора. На сцене — рядом с SoundController (тот же узел или дочерний).
 */
@ccclass('SoundLibrary')
export class SoundLibrary extends Component {
    @property({
        group: G_GAMEPLAY,
        type: [AudioClip],
        displayName: 'Seed Collect',
        tooltip:
            'Варианты звука сбора семечка. Случайный выбор без повтора подряд.',
    })
    seedCollectClips: AudioClip[] = [];

    @property({
        group: G_PLAYER,
        type: [AudioClip],
        displayName: 'Wing Flap',
        tooltip:
            'Хлопанье крыльев при тапе во время полёта. Случайный вариант без повтора подряд.',
    })
    wingFlapClips: AudioClip[] = [];

    @property({
        group: G_PLAYER,
        type: AudioClip,
        displayName: 'Session First Tap',
        tooltip:
            'Один раз за сессию: самый первый тап по экрану (старт первого забега).',
    })
    sessionFirstTap: AudioClip | null = null;

    @property({
        group: G_GAMEPLAY,
        type: AudioClip,
        displayName: 'Pickup Collect',
        tooltip: 'Общий звук сбора (монеты и др.), если нет своего в пикапе.',
    })
    pickupCollect: AudioClip | null = null;

    @property({ group: G_GAMEPLAY, type: AudioClip })
    damage: AudioClip | null = null;

    @property({ group: G_GAMEPLAY, type: AudioClip })
    electricHit: AudioClip | null = null;

    @property({
        group: G_GAMEPLAY,
        type: AudioClip,
        displayName: 'Wall Hit',
        tooltip:
            'Удар о стену в забеге и доп. «удар» при показе Game Over (вместе с джинглом).',
    })
    wallHit: AudioClip | null = null;

    @property({ group: G_GAMEPLAY, type: AudioClip })
    instantKill: AudioClip | null = null;

    @property({
        group: G_UI,
        type: AudioClip,
        displayName: 'Game Over Jingle',
        tooltip:
            'Однократный джингл при поражении (отдельно от Wall Hit; можно другой клип).',
    })
    gameOver: AudioClip | null = null;

    @property({
        group: G_UI,
        type: AudioClip,
        displayName: 'Tap Start',
        tooltip: 'Тап для рестарта после game over (не первый тап сессии).',
    })
    tapStart: AudioClip | null = null;

    @property({
        group: G_MILESTONE,
        type: AudioClip,
        displayName: 'Milestone Passed',
        tooltip: 'Когда голубь пролетает столб-веху (MilestoneSign).',
    })
    milestonePassed: AudioClip | null = null;

    @property({
        group: G_MILESTONE,
        type: AudioClip,
        displayName: 'Speed Boost',
        tooltip: 'Ускорение после прохождения вехи (Pass Boost).',
    })
    speedBoost: AudioClip | null = null;

    @property({
        group: G_MUSIC,
        type: AudioClip,
        displayName: 'BGM · Waiting',
        tooltip: 'Пока игрок не начал забег (ожидание тапа).',
    })
    bgmWaiting: AudioClip | null = null;

    @property({
        group: G_MUSIC,
        type: AudioClip,
        displayName: 'BGM · Gameplay',
        tooltip: 'Во время активного забега.',
    })
    bgmGameplay: AudioClip | null = null;

    @property({
        group: G_MUSIC,
        type: AudioClip,
        displayName: 'BGM · KTA',
        tooltip:
            'С открытия KTA; рестарт только при входе на KTA. Play Again — трек продолжается до нового забега.',
    })
    bgmKta: AudioClip | null = null;

    public getMusicClip(track: MusicTrack): AudioClip | null {
        switch (track) {
            case MusicTrack.Waiting:
                return this.bgmWaiting;
            case MusicTrack.Gameplay:
                return this.bgmGameplay;
            case MusicTrack.Kta:
                return this.bgmKta;
            default:
                return null;
        }
    }

    private _lastSeedCollectIndex = -1;
    private _lastWingFlapIndex = -1;

    public resetSeedCollectRotation(): void {
        this._lastSeedCollectIndex = -1;
    }

    public resetWingFlapRotation(): void {
        this._lastWingFlapIndex = -1;
    }

    public resetVariantRotation(): void {
        this.resetSeedCollectRotation();
        this.resetWingFlapRotation();
    }

    public pickSeedCollectClip(): AudioClip | null {
        return SoundLibrary._pickNoRepeat(
            this.seedCollectClips,
            this._lastSeedCollectIndex,
            (i) => {
                this._lastSeedCollectIndex = i;
            },
        );
    }

    public pickWingFlapClip(): AudioClip | null {
        return SoundLibrary._pickNoRepeat(
            this.wingFlapClips,
            this._lastWingFlapIndex,
            (i) => {
                this._lastWingFlapIndex = i;
            },
        );
    }

    public getClip(id: SoundId): AudioClip | null {
        switch (id) {
            case SoundId.SeedCollect:
                return this.pickSeedCollectClip();
            case SoundId.WingFlap:
                return this.pickWingFlapClip();
            case SoundId.PickupCollect:
                return this.pickupCollect;
            case SoundId.Damage:
                return this.damage;
            case SoundId.ElectricHit:
                return this.electricHit;
            case SoundId.WallHit:
                return this.wallHit;
            case SoundId.InstantKill:
                return this.instantKill;
            case SoundId.GameOver:
                return this.gameOver;
            case SoundId.TapStart:
                return this.tapStart;
            case SoundId.SessionFirstTap:
                return this.sessionFirstTap;
            case SoundId.MilestonePassed:
                return this.milestonePassed;
            case SoundId.SpeedBoost:
                return this.speedBoost;
            default:
                return null;
        }
    }

    private static _pickNoRepeat(
        source: AudioClip[],
        lastIndex: number,
        setLastIndex: (index: number) => void,
    ): AudioClip | null {
        const pool: AudioClip[] = [];
        for (const c of source) {
            if (c) {
                pool.push(c);
            }
        }
        const n = pool.length;
        if (n === 0) {
            return null;
        }
        if (n === 1) {
            setLastIndex(0);
            return pool[0];
        }

        const candidates: number[] = [];
        for (let i = 0; i < n; i++) {
            if (i !== lastIndex) {
                candidates.push(i);
            }
        }
        const idx =
            candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
        setLastIndex(idx);
        return pool[idx];
    }
}
