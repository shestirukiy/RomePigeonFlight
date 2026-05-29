import {
    _decorator,
    Animation,
    AnimationClip,
    Component,
    Prefab,
    Sprite,
    Vec3,
    instantiate,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Спавн — сосед маркера (родитель чанка): local (0,0,0), scale (1,1,1).
 * Позицию задаёт только клип (запечён под этого родителя), маркер — точка в редакторе.
 */
@ccclass('AnimatedPrefabSpawner')
export class AnimatedPrefabSpawner extends Component {
    @property({
        type: [Prefab],
        displayName: 'Prefab Variants',
        tooltip: 'Sprite + Animation, один цикл.',
    })
    prefabVariants: Prefab[] = [];

    @property({
        displayName: 'Spawn Interval (sec)',
        tooltip: 'Пауза между появлениями.',
    })
    spawnIntervalSec = 0.35;

    @property({
        displayName: 'Hide Marker Sprite',
        tooltip: 'Скрыть только Sprite на маркере (маркер-префаб).',
    })
    hideAnchorVisual = true;

    @property({
        displayName: 'Spawn On Enable',
        tooltip: 'Запускать таймер при включении.',
    })
    spawnOnEnable = true;

    @property({
        displayName: 'Clip Name Override',
        tooltip: 'Пусто — defaultClip или первый клип.',
    })
    clipNameOverride = '';

    @property({
        displayName: 'Fallback Lifetime (sec)',
        tooltip: 'Удалить, если FINISHED не пришёл.',
    })
    fallbackLifetimeSec = 10;

    @property({
        displayName: 'Initial Crowd Count',
        tooltip: 'Стартовая толпа (0 = выкл).',
    })
    initialCrowdCount = 0;

    @property({
        displayName: 'Initial Crowd Stagger (sec)',
        tooltip: 'Шаг по времени для толпы. 0 = Spawn Interval.',
    })
    initialCrowdStaggerSec = 0;

    private _lastVariantIndex = -1;
    private readonly _trackedSpawns: Node[] = [];

    onEnable() {
        this._applyMarkerSpriteHidden();
        if (this.spawnOnEnable) {
            this.startSpawning();
        }
    }

    onDisable() {
        this.stopSpawning();
        this._clearTrackedSpawns();
    }

    public startSpawning(): void {
        this.stopSpawning();
        this.schedule(this._spawnOne, Math.max(0.05, this.spawnIntervalSec));
    }

    public stopSpawning(): void {
        this.unschedule(this._spawnOne);
    }

    public prewarmNow(): void {
        this.seedInitialCrowd();
    }

    public seedInitialCrowd(): void {
        const count = Math.max(0, Math.floor(this.initialCrowdCount));
        if (count === 0 || !this.node?.isValid) {
            return;
        }

        const variants = this._getValidVariants();
        if (variants.length === 0) {
            return;
        }

        this._clearTrackedSpawns();

        const stagger =
            this.initialCrowdStaggerSec > 0
                ? this.initialCrowdStaggerSec
                : Math.max(0.05, this.spawnIntervalSec);

        for (let i = 0; i < count; i++) {
            const prefab = variants[this._pickVariantIndex(variants.length)];
            if (!prefab) {
                continue;
            }
            const animStartTime = (count - 1 - i) * stagger;
            this._spawnAnimated(prefab, animStartTime);
        }
    }

    private _spawnOne(): void {
        const variants = this._getValidVariants();
        if (variants.length === 0 || !this.node?.isValid) {
            return;
        }

        const prefab = variants[this._pickVariantIndex(variants.length)];
        if (prefab) {
            this._spawnAnimated(prefab, 0);
        }
    }

    private _spawnAnimated(prefab: Prefab, animStartTime: number): void {
        const marker = this.node;
        const holder = marker.parent;
        if (!marker?.isValid || !holder?.isValid) {
            return;
        }

        const instance = instantiate(prefab);
        if (!instance?.isValid) {
            return;
        }

        instance.active = false;
        instance.setParent(holder, false);
        instance.setPosition(marker.position);
        instance.setScale(Vec3.ONE);

        this._trackedSpawns.push(instance);

        const anim =
            instance.getComponent(Animation) ??
            instance.getComponentInChildren(Animation);

        if (!anim) {
            this._destroyAfter(instance, this.fallbackLifetimeSec);
            return;
        }

        const clipName = this._resolveClipName(anim);
        if (!clipName) {
            this._destroyAfter(instance, this.fallbackLifetimeSec);
            return;
        }

        let destroyed = false;
        const destroyInstance = () => {
            if (destroyed || !instance.isValid) {
                return;
            }
            destroyed = true;
            this._untrackInstance(instance);
            instance.destroy();
        };

        const cleanup = () => {
            anim.off(Animation.EventType.FINISHED, onFinished, this);
            this.unschedule(fallbackDestroy);
        };

        const onFinished = (_type?: string, st?: { name?: string }) => {
            if (st?.name && st.name !== clipName) {
                return;
            }
            cleanup();
            destroyInstance();
        };

        const fallbackDestroy = () => {
            cleanup();
            destroyInstance();
        };

        anim.on(Animation.EventType.FINISHED, onFinished, this);

        const midStart = animStartTime > 0;
        const sprite = instance.getComponent(Sprite);

        if (midStart) {
            anim.playOnLoad = false;
            if (sprite) {
                sprite.enabled = false;
            }
        }

        instance.active = true;

        if (midStart) {
            anim.play(clipName);
            const state = anim.getState(clipName);
            if (state) {
                state.wrapMode = AnimationClip.WrapMode.Normal;
                const duration = state.duration || 0;
                state.time = Math.min(
                    animStartTime,
                    Math.max(0, duration - 0.02),
                );
                state.sample();
                state.resume();
            }
            if (sprite) {
                sprite.enabled = true;
            }
        }

        this.scheduleOnce(
            fallbackDestroy,
            Math.max(0.05, this.fallbackLifetimeSec),
        );
    }

    private _applyMarkerSpriteHidden(): void {
        if (!this.hideAnchorVisual || !this.node?.isValid) {
            return;
        }
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.enabled = false;
        }
        const markerAnim = this.node.getComponent(Animation);
        if (markerAnim) {
            markerAnim.stop();
            markerAnim.enabled = false;
        }
    }

    private _getValidVariants(): Prefab[] {
        return (this.prefabVariants ?? []).filter((p): p is Prefab => !!p);
    }

    private _pickVariantIndex(count: number): number {
        if (count <= 1) {
            this._lastVariantIndex = 0;
            return 0;
        }

        let index = Math.floor(Math.random() * count);
        if (index === this._lastVariantIndex) {
            index = (index + 1) % count;
        }
        this._lastVariantIndex = index;
        return index;
    }

    private _resolveClipName(anim: Animation): string {
        const override = this.clipNameOverride.trim();
        if (override) {
            return override;
        }
        return anim.defaultClip?.name ?? anim.clips[0]?.name ?? '';
    }

    private _untrackInstance(instance: Node): void {
        const i = this._trackedSpawns.indexOf(instance);
        if (i >= 0) {
            this._trackedSpawns.splice(i, 1);
        }
    }

    private _clearTrackedSpawns(): void {
        for (const node of this._trackedSpawns) {
            if (node?.isValid) {
                node.destroy();
            }
        }
        this._trackedSpawns.length = 0;
    }

    private _destroyAfter(node: Node, delaySec: number): void {
        this.scheduleOnce(() => {
            if (node.isValid) {
                this._untrackInstance(node);
                node.destroy();
            }
        }, Math.max(0.05, delaySec));
    }
}
