import {
    _decorator,
    assetManager,
    Component,
    game,
    ImageAsset,
    instantiate,
    Mat4,
    Node,
    Prefab,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
    Vec3,
} from 'cc';
import { FeatherFloat } from './FeatherFloat';

const { ccclass, property } = _decorator;

const G_MASK = { id: 'Mask', name: 'Mask sprites' };
const G_FILL = { id: 'Fill', name: 'Fill' };
const G_SPAWN = { id: 'Spawn', name: 'Spawned seeds' };

type MaskAlphaGrid = {
    width: number;
    height: number;
    alpha: Uint8Array;
    readable: boolean;
};

/**
 * Заполняет силуэт Sprite префабами семечек по сетке (по альфе / яркости текстуры маски).
 */
@ccclass('SeedPattern')
export class SeedPattern extends Component {
    @property({
        group: G_MASK,
        type: [Node],
        displayName: 'Mask Sprite Nodes',
        tooltip:
            'Ноды с Sprite (силуэт). Пусто — все Sprite в дочерних узлах (кроме Seeds).',
    })
    maskSpriteNodes: Node[] = [];

    @property({
        group: G_FILL,
        type: Prefab,
        displayName: 'Seed Prefab',
        tooltip: 'Обычно prefabs/seed.',
    })
    seedPrefab: Prefab | null = null;

    @property({
        group: G_FILL,
        displayName: 'Fill Density',
        tooltip:
            'Плотность: семечек на 10 000 px² видимой области силуэта (экранные пиксели). ' +
            'Чем больше — тем плотнее. Количество семечек зависит от размера формы.',
    })
    fillDensity = 5;

    @property({
        group: G_FILL,
        displayName: 'Alpha Threshold',
        slide: true,
        min: 0.01,
        max: 1,
        step: 0.01,
        tooltip: 'Порог 0.1–0.25 для PNG с мягкими краями.',
    })
    alphaThreshold = 0.15;

    @property({
        group: G_FILL,
        displayName: 'Fill Rect If Alpha Unreadable',
        tooltip:
            'Если силуэт прочитать нельзя — залить весь прямоугольник Sprite (временный fallback).',
    })
    fillRectWhenAlphaUnreadable = true;

    @property({
        group: G_FILL,
        displayName: 'Position Jitter',
        tooltip: 'Случайный сдвиг ±px в локали SeedPattern.',
    })
    positionJitter = 6;

    @property({
        group: G_FILL,
        displayName: 'Max Seeds (Safety)',
        tooltip:
            'Только защита от переполнения при очень высокой плотности. 0 — без лимита.',
    })
    maxSeedsSafetyCap = 0;

    @property({
        group: G_FILL,
        displayName: 'Fill On Enable',
    })
    fillOnEnable = true;

    @property({
        group: G_FILL,
        displayName: 'Hide Masks After Fill',
    })
    hideMaskAfterFill = true;

    @property({
        group: G_SPAWN,
        type: Node,
        displayName: 'Seeds Container',
        tooltip:
            'Пусто — дочерняя нода Seeds. Не назначайте корень SeedPattern.',
    })
    seedsContainer: Node | null = null;

    private _fillTimerPending = false;
    private _fillRetryCount = 0;
    private _pendingFill = false;
    private _asyncAlphaReloadPending = false;
    private static readonly _vLocal = new Vec3();
    private static readonly _vWorld = new Vec3();
    private static readonly _matInv = new Mat4();
    private readonly _hiddenMaskNodes: Node[] = [];
    private _maskGrids = new WeakMap<Sprite, MaskAlphaGrid>();
    private static _gridCache = new Map<string, MaskAlphaGrid>();
    private static _nativeUrlLoadPromises = new Map<
        string,
        Promise<Uint8Array | null>
    >();

    private readonly _onFillDeferred = () => {
        this._fillTimerPending = false;
        if (!this.isValid || !this.node?.isValid) {
            return;
        }
        this.fill();
    };

    /**
     * Чанк уже активен на сцене: onEnable был в редакторе до Play — заливка не вызывалась.
     * start() срабатывает при каждом запуске preview/игры.
     */
    start() {
        if (this.fillOnEnable) {
            this._queueFill();
        }
    }

    onEnable() {
        if (!this.fillOnEnable || !game.isRunning) {
            return;
        }
        this._queueFill();
    }

    private _queueFill(): void {
        this._fillRetryCount = 0;
        this._pendingFill = true;
    }

    lateUpdate(): void {
        if (!this._pendingFill) {
            return;
        }
        this._pendingFill = false;
        this.fill();
    }

    onDisable() {
        this._cancelFillTimer();
        this.clear();
        this._restoreMasks();
    }

    onDestroy() {
        this._cancelFillTimer();
        this.clear();
        this._restoreMasks();
    }

    private _cancelFillTimer(): void {
        if (!this._fillTimerPending) {
            return;
        }
        this._fillTimerPending = false;
        if (!this.isValid) {
            return;
        }
        this.unschedule(this._onFillDeferred);
    }

    public fill(): void {
        if (!this.seedPrefab) {
            console.warn('[SeedPattern] Укажите Seed Prefab.');
            return;
        }

        const patternUi = this.node.getComponent(UITransform);
        if (!patternUi) {
            console.warn('[SeedPattern] Нужен UITransform на этой ноде.');
            return;
        }

        const masks = this._collectMaskSprites();
        if (masks.length === 0) {
            if (this.seedsContainer === this.node) {
                console.warn(
                    '[SeedPattern] Seeds Container не должен быть корнем — оставьте пустым.',
                );
            } else {
                console.warn('[SeedPattern] Нет Sprite-масок для заливки.');
            }
            return;
        }

        this._restoreMasks();
        this.clear();
        this._maskGrids = new WeakMap();

        const container = this._ensureSeedsContainer();

        const layerRef = masks[0]?.node ?? this.node;
        let placed = 0;
        const cap =
            this.maxSeedsSafetyCap > 0
                ? this.maxSeedsSafetyCap
                : Number.MAX_SAFE_INTEGER;

        for (const sprite of masks) {
            if (placed >= cap) {
                break;
            }
            const sf = sprite.spriteFrame;
            if (!sf) {
                continue;
            }
            const grid = SeedPattern._getOrBuildAlphaGrid(
                sf,
                this.fillRectWhenAlphaUnreadable,
            );
            this._maskGrids.set(sprite, grid);
            if (!grid.readable) {
                this._scheduleAlphaReloadFromImage(sf);
            }
            const maskUi = sprite.node.getComponent(UITransform);
            if (!maskUi) {
                continue;
            }
            const spacing = this._computeSpacingForMask(sprite, grid, maskUi);
            placed += this._fillOneMask(
                sprite,
                grid,
                maskUi,
                container,
                layerRef,
                spacing,
                cap - placed,
            );
        }

        if (placed === 0) {
            if (this._fillRetryCount < 4) {
                this._fillRetryCount++;
                this.scheduleOnce(() => {
                    this._pendingFill = true;
                }, 0.05);
                return;
            }
            console.warn(
                `[SeedPattern] «${this.node.name}»: семечки не поставлены (порог ${this.alphaThreshold}). ` +
                    'Mask Sprite Nodes, Seed Prefab, Alpha Threshold (~0.1).',
            );
        } else {
            this._fillRetryCount = 0;
            console.log(
                `[SeedPattern] «${this.node.name}»: поставлено ${placed} семечек (плотность ${this.fillDensity}).`,
            );
        }

        if (this.hideMaskAfterFill) {
            for (const sprite of masks) {
                const n = sprite.node;
                if (!n?.isValid || !n.active) {
                    continue;
                }
                n.active = false;
                this._hiddenMaskNodes.push(n);
            }
        }
    }

    /** В preview/GPU без CPU-пикселей — догружаем PNG по nativeUrl и перезаливаем силуэт. */
    private _scheduleAlphaReloadFromImage(sf: SpriteFrame): void {
        if (this._asyncAlphaReloadPending) {
            return;
        }
        const image = (sf.texture as Texture2D | null)?.image as
            | ImageAsset
            | undefined;
        const url = SeedPattern._resolveImageUrl(image);
        if (!url) {
            if (!this.fillRectWhenAlphaUnreadable) {
                console.warn(
                    `[SeedPattern] Альфа «${sf.name}» недоступна — включите Fill Rect If Alpha Unreadable.`,
                );
            }
            return;
        }

        this._asyncAlphaReloadPending = true;
        const tw = image?.width ?? Math.floor(sf.rect.width);
        const th = image?.height ?? Math.floor(sf.rect.height);

        let load = SeedPattern._nativeUrlLoadPromises.get(url);
        if (!load) {
            load = SeedPattern._loadPixelsFromUrl(url, tw, th);
            SeedPattern._nativeUrlLoadPromises.set(url, load);
        }

        load.then((pixels) => {
            this._asyncAlphaReloadPending = false;
            if (!pixels || !this.isValid || !this.node?.isValid) {
                return;
            }
            const cacheKey = `${sf.uuid}|${this.fillRectWhenAlphaUnreadable ? 1 : 0}`;
            SeedPattern._gridCache.set(
                cacheKey,
                SeedPattern._buildAlphaGridFromRgba(
                    sf,
                    pixels,
                    tw,
                    th,
                    false,
                ),
            );
            this._pendingFill = true;
        });
    }

    /** Локаль маски → локаль контейнера Seeds через worldMatrix (надёжнее UITransform.convert*). */
    private _maskLocalToContainer(
        maskNode: Node,
        containerNode: Node,
        lx: number,
        ly: number,
        out: Vec3,
    ): void {
        SeedPattern._updateWorldTransformChain(maskNode);
        SeedPattern._updateWorldTransformChain(containerNode);
        SeedPattern._vLocal.set(lx, ly, 0);
        Vec3.transformMat4(
            SeedPattern._vWorld,
            SeedPattern._vLocal,
            maskNode.worldMatrix,
        );
        Mat4.invert(SeedPattern._matInv, containerNode.worldMatrix);
        Vec3.transformMat4(out, SeedPattern._vWorld, SeedPattern._matInv);
    }

    private static _updateWorldTransformChain(node: Node): void {
        let n: Node | null = node;
        while (n) {
            n.updateWorldTransform();
            n = n.parent;
        }
    }

    /** Площадь силуэта в экранных px² и шаг сетки из fillDensity. */
    private _computeSpacingForMask(
        sprite: Sprite,
        grid: MaskAlphaGrid,
        maskUi: UITransform,
    ): number {
        const w = maskUi.width;
        const h = maskUi.height;
        const ws = Math.max(0.001, Math.abs(sprite.node.worldScale.x));
        const hs = Math.max(0.001, Math.abs(sprite.node.worldScale.y));
        const screenW = w * ws;
        const screenH = h * hs;

        let visibleArea = screenW * screenH;
        if (grid.readable) {
            const thr = Math.floor(this.alphaThreshold * 255);
            let cells = 0;
            for (let i = 0; i < grid.alpha.length; i++) {
                if (grid.alpha[i] >= thr) {
                    cells++;
                }
            }
            if (cells > 0) {
                const cellArea =
                    (screenW / grid.width) * (screenH / grid.height);
                visibleArea = cells * cellArea;
            }
        }

        const density = Math.max(0.1, this.fillDensity);
        const targetSeeds = Math.max(
            1,
            (visibleArea * density) / 10000,
        );
        const spacing = Math.sqrt(visibleArea / targetSeeds);
        return Math.max(8, Math.min(150, spacing));
    }

    /**
     * Сетка в локали Sprite (0…width, 0…height), позиции семечек — в локали контейнера Seeds.
     */
    private _fillOneMask(
        sprite: Sprite,
        grid: MaskAlphaGrid,
        maskUi: UITransform,
        container: Node,
        layerRef: Node,
        spacing: number,
        budget: number,
    ): number {
        const w = maskUi.width;
        const h = maskUi.height;
        if (w <= 0 || h <= 0) {
            return 0;
        }

        const ws = Math.max(0.001, Math.abs(sprite.node.worldScale.x));
        const hs = Math.max(0.001, Math.abs(sprite.node.worldScale.y));
        const stepX = spacing / ws;
        const stepY = spacing / hs;
        const tint = sprite.color.a / 255;
        const threshold = this.alphaThreshold;

        const posInContainer = new Vec3();
        const maskNode = sprite.node;
        let placed = 0;

        for (let py = 0; py <= h && placed < budget; py += stepY) {
            for (let px = 0; px <= w && placed < budget; px += stepX) {
                const a = this._alphaFromGrid(grid, px, py) * tint;
                if (a < threshold) {
                    continue;
                }

                const jx =
                    this.positionJitter > 0
                        ? (Math.random() * 2 - 1) * this.positionJitter
                        : 0;
                const jy =
                    this.positionJitter > 0
                        ? (Math.random() * 2 - 1) * this.positionJitter
                        : 0;

                const lx = px - w * maskUi.anchorX + jx / ws;
                const ly = py - h * maskUi.anchorY + jy / hs;
                this._maskLocalToContainer(
                    maskNode,
                    container,
                    lx,
                    ly,
                    posInContainer,
                );

                const seed = instantiate(this.seedPrefab!);
                seed.parent = container;
                seed.setPosition(
                    posInContainer.x,
                    posInContainer.y,
                    posInContainer.z,
                );
                // FeatherFloat.onLoad снимает якорь до setPosition (в префабе ~167,261) — иначе все в одной точке.
                seed.getComponent(FeatherFloat)?.recaptureAnchor();
                SeedPattern._syncLayerWith(seed, layerRef);
                placed++;
            }
        }

        return placed;
    }

    private _alphaFromGrid(grid: MaskAlphaGrid, px: number, py: number): number {
        if (!grid.readable) {
            return grid.alpha[0] === 255 ? 1 : 0;
        }
        const ix = Math.min(grid.width - 1, Math.max(0, Math.floor(px)));
        const iy = Math.min(grid.height - 1, Math.max(0, Math.floor(py)));
        return grid.alpha[iy * grid.width + ix] / 255;
    }

    public clear(): void {
        const container = this._resolveSeedsContainer();
        if (!container?.isValid) {
            return;
        }
        for (const ch of [...container.children]) {
            if (ch.isValid) {
                ch.destroy();
            }
        }
    }

    private _restoreMasks(): void {
        for (const n of this._hiddenMaskNodes) {
            if (n?.isValid) {
                n.active = true;
            }
        }
        this._hiddenMaskNodes.length = 0;
    }

    private static _syncLayerWith(root: Node, ref: Node): void {
        const layer = ref.layer;
        const visit = (n: Node) => {
            n.layer = layer;
            for (const ch of n.children) {
                visit(ch);
            }
        };
        visit(root);
    }

    private _resolveSeedsContainer(): Node | null {
        const c = this.seedsContainer;
        if (c?.isValid && c !== this.node) {
            return c;
        }
        if (c === this.node) {
            console.warn(
                '[SeedPattern] Seeds Container = корень чанка — используется дочерняя нода Seeds.',
            );
        }
        const named = this.node.getChildByName('Seeds');
        return named?.isValid ? named : null;
    }

    private _ensureSeedsContainer(): Node {
        const existing = this._resolveSeedsContainer();
        if (existing) {
            if (this.seedsContainer !== existing) {
                this.seedsContainer = existing;
            }
            return existing;
        }
        const node = new Node('Seeds');
        node.parent = this.node;
        node.addComponent(UITransform);
        node.layer = this.node.layer;
        this.seedsContainer = node;
        return node;
    }

    private _isUnderSeedsContainer(node: Node): boolean {
        const container = this._resolveSeedsContainer();
        if (!container?.isValid) {
            return false;
        }
        return node === container || node.isChildOf(container);
    }

    private _collectMaskSprites(): Sprite[] {
        const out: Sprite[] = [];
        const seen = new Set<Sprite>();

        const addFrom = (root: Node | null) => {
            if (!root?.isValid) {
                return;
            }
            for (const s of root.getComponentsInChildren(Sprite)) {
                if (!s?.isValid || seen.has(s)) {
                    continue;
                }
                if (this._isUnderSeedsContainer(s.node)) {
                    continue;
                }
                if (!s.spriteFrame) {
                    continue;
                }
                seen.add(s);
                out.push(s);
            }
        };

        if (this.maskSpriteNodes.length > 0) {
            for (const n of this.maskSpriteNodes) {
                addFrom(n);
            }
        } else {
            addFrom(this.node);
        }

        return out;
    }

    private static _getOrBuildAlphaGrid(
        sf: SpriteFrame,
        rectFallback: boolean,
    ): MaskAlphaGrid {
        const key = `${sf.uuid}|${rectFallback ? 1 : 0}`;
        const cached = SeedPattern._gridCache.get(key);
        if (cached) {
            return cached;
        }
        const built = SeedPattern._buildAlphaGrid(sf, rectFallback);
        if (built.readable || rectFallback) {
            SeedPattern._gridCache.set(key, built);
        }
        return built;
    }

    private static _buildAlphaGrid(
        sf: SpriteFrame,
        rectFallback: boolean,
    ): MaskAlphaGrid {
        const rect = sf.rect;
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));

        const fromRect = SeedPattern._readSpriteFrameRectPixels(sf);
        if (fromRect) {
            return SeedPattern._alphaGridFromBuffer(
                fromRect.data,
                fromRect.width,
                fromRect.height,
                fromRect.flipY,
            );
        }

        const fromPixels = SeedPattern._readFullTexturePixels(sf);
        if (fromPixels) {
            return SeedPattern._buildAlphaGridFromRgba(
                sf,
                fromPixels.data,
                fromPixels.width,
                fromPixels.height,
                fromPixels.originBottomLeft,
            );
        }

        const alpha = new Uint8Array(w * h);
        if (rectFallback) {
            alpha.fill(255);
            return { width: w, height: h, alpha, readable: false };
        }

        return { width: w, height: h, alpha, readable: false };
    }

    private static _buildAlphaGridFromRgba(
        sf: SpriteFrame,
        src: Uint8Array,
        tw: number,
        th: number,
        originBottomLeft: boolean,
    ): MaskAlphaGrid {
        const rect = sf.rect;
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        const alpha = new Uint8Array(w * h);

        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const u = (i + 0.5) / w;
                const v = (j + 0.5) / h;
                const tx = Math.min(
                    tw - 1,
                    Math.max(0, Math.floor(rect.x + rect.width * u)),
                );
                const tyTop = Math.min(
                    th - 1,
                    Math.max(0, Math.floor(rect.y + rect.height * (1 - v))),
                );
                const ty = originBottomLeft
                    ? Math.min(
                          th - 1,
                          Math.max(0, Math.floor(rect.y + rect.height * v)),
                      )
                    : tyTop;
                const si = (ty * tw + tx) * 4;
                if (si + 3 >= src.length) {
                    alpha[j * w + i] = 0;
                    continue;
                }
                alpha[j * w + i] = SeedPattern._pixelVisibility(
                    src[si],
                    src[si + 1],
                    src[si + 2],
                    src[si + 3],
                );
            }
        }
        return { width: w, height: h, alpha, readable: true };
    }

    private static _alphaGridFromBuffer(
        src: Uint8Array,
        w: number,
        h: number,
        flipY: boolean,
    ): MaskAlphaGrid {
        const alpha = new Uint8Array(w * h);
        for (let j = 0; j < h; j++) {
            const row = flipY ? h - 1 - j : j;
            for (let i = 0; i < w; i++) {
                const si = (row * w + i) * 4;
                if (si + 3 >= src.length) {
                    alpha[j * w + i] = 0;
                    continue;
                }
                alpha[j * w + i] = SeedPattern._pixelVisibility(
                    src[si],
                    src[si + 1],
                    src[si + 2],
                    src[si + 3],
                );
            }
        }
        return { width: w, height: h, alpha, readable: true };
    }

    private static _readSpriteFrameRectPixels(
        sf: SpriteFrame,
    ): { width: number; height: number; data: Uint8Array; flipY: boolean } | null {
        const tex = sf.texture as Texture2D | null;
        if (!tex || typeof tex.readPixels !== 'function') {
            return null;
        }
        const rect = sf.rect;
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        try {
            const buffer = new Uint8Array(w * h * 4);
            tex.readPixels(Math.floor(rect.x), Math.floor(rect.y), w, h, buffer);
            if (!SeedPattern._bufferHasVisiblePixels(buffer)) {
                return null;
            }
            return { width: w, height: h, data: buffer, flipY: true };
        } catch {
            return null;
        }
    }

    private static _bufferHasVisiblePixels(buf: Uint8Array): boolean {
        for (let i = 3; i < buf.length; i += 4) {
            if (buf[i] > 8) {
                return true;
            }
        }
        return false;
    }

    /** Видимый пиксель: альфа или непустой RGB (на случай спрайтов без альфа-канала). */
    private static _pixelVisibility(
        r: number,
        g: number,
        b: number,
        a: number,
    ): number {
        if (a > 8) {
            return a;
        }
        const lum = Math.max(r, g, b);
        return lum > 24 ? lum : 0;
    }

    private static _readFullTexturePixels(
        sf: SpriteFrame,
    ): { width: number; height: number; data: Uint8Array; originBottomLeft: boolean } | null {
        const tex = sf.texture as Texture2D | null;
        if (!tex) {
            return null;
        }

        const image = tex.image as ImageAsset | undefined;
        const tw = image?.width ?? tex.width;
        const th = image?.height ?? tex.height;
        if (tw <= 0 || th <= 0) {
            return null;
        }

        const fromImage = SeedPattern._pixelsFromImageAsset(image, tw, th);
        if (fromImage && SeedPattern._bufferHasVisiblePixels(fromImage)) {
            return {
                width: tw,
                height: th,
                data: fromImage,
                originBottomLeft: false,
            };
        }

        if (typeof tex.readPixels === 'function') {
            try {
                const buffer = new Uint8Array(tw * th * 4);
                tex.readPixels(0, 0, tw, th, buffer);
                if (SeedPattern._bufferHasVisiblePixels(buffer)) {
                    return {
                        width: tw,
                        height: th,
                        data: buffer,
                        originBottomLeft: true,
                    };
                }
            } catch {
                /* readback недоступен */
            }
        }

        return null;
    }

    private static _resolveImageUrl(image: ImageAsset | undefined): string | null {
        if (!image) {
            return null;
        }
        if (image.nativeUrl) {
            return image.nativeUrl;
        }
        try {
            const url = assetManager.utils.getUrlWithUuid(image.uuid, {
                isNative: true,
            });
            return url || null;
        } catch {
            return null;
        }
    }

    private static _loadPixelsFromUrl(
        url: string,
        tw: number,
        th: number,
    ): Promise<Uint8Array | null> {
        return new Promise((resolve) => {
            if (typeof Image === 'undefined') {
                resolve(null);
                return;
            }
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const w = img.naturalWidth || tw;
                const h = img.naturalHeight || th;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(SeedPattern._canvasToRgba(canvas, w, h));
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    private static _pixelsFromImageAsset(
        image: ImageAsset | undefined,
        tw: number,
        th: number,
    ): Uint8Array | null {
        if (!image) {
            return null;
        }

        const raw = image.data as unknown;
        if (raw instanceof Uint8Array) {
            return raw;
        }
        if (raw instanceof Uint8ClampedArray) {
            return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        }

        if (typeof HTMLCanvasElement !== 'undefined') {
            if (raw instanceof HTMLCanvasElement) {
                return SeedPattern._canvasToRgba(raw, tw, th);
            }
            if (raw instanceof HTMLImageElement) {
                return SeedPattern._drawToCanvasPixels(raw, tw, th);
            }
            if (typeof ImageBitmap !== 'undefined' && raw instanceof ImageBitmap) {
                return SeedPattern._drawToCanvasPixels(raw, tw, th);
            }
        }

        const html = (image as { _htmlElement?: HTMLImageElement })._htmlElement;
        if (html) {
            return SeedPattern._drawToCanvasPixels(html, tw, th);
        }

        const native = (
            image as { _nativeAsset?: HTMLImageElement | ImageBitmap }
        )._nativeAsset;
        if (native instanceof HTMLImageElement) {
            return SeedPattern._drawToCanvasPixels(native, tw, th);
        }
        if (
            typeof ImageBitmap !== 'undefined' &&
            native instanceof ImageBitmap
        ) {
            return SeedPattern._drawToCanvasPixels(native, tw, th);
        }

        return null;
    }

    private static _drawToCanvasPixels(
        source: CanvasImageSource,
        tw: number,
        th: number,
    ): Uint8Array | null {
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.drawImage(source, 0, 0, tw, th);
        return SeedPattern._canvasToRgba(canvas, tw, th);
    }

    private static _canvasToRgba(
        canvas: HTMLCanvasElement,
        tw: number,
        th: number,
    ): Uint8Array | null {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        const img = ctx.getImageData(0, 0, tw, th);
        return new Uint8Array(
            img.data.buffer,
            img.data.byteOffset,
            img.data.byteLength,
        );
    }
}
