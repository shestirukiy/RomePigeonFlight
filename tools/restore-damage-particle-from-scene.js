/**
 * Copies tuned ParticleSystem2D from Main.scene → DamageParticleGO
 * into DamageParticleFX.prefab and restores DamageParticle child on Player.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const scenePath = path.join(root, 'assets/Main.scene');
const fxPath = path.join(root, 'assets/prefabs/fx/DamageParticleFX.prefab');
const playerPath = path.join(root, 'assets/prefabs/Player.prefab');

const FX_OFFSET = { x: 24.684, y: -8.364, z: 0 };

function loadJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findSceneDamageParticle(scene) {
    const nodeIdx = scene.findIndex((x) => x && x._name === 'DamageParticleGO');
    if (nodeIdx < 0) {
        throw new Error('DamageParticleGO not found in Main.scene');
    }
    const ps = scene.find(
        (x) =>
            x &&
            x.__type__ === 'cc.ParticleSystem2D' &&
            x.node &&
            x.node.__id__ === nodeIdx,
    );
    const ui = scene.find(
        (x) =>
            x &&
            x.__type__ === 'cc.UITransform' &&
            x.node &&
            x.node.__id__ === nodeIdx,
    );
    if (!ps) {
        throw new Error('ParticleSystem2D on DamageParticleGO not found');
    }
    return { nodeIdx, ps: JSON.parse(JSON.stringify(ps)), ui: ui ? JSON.parse(JSON.stringify(ui)) : null };
}

function tuneForSpawnPrefab(ps) {
    ps.playOnLoad = false;
    ps.autoRemoveOnFinish = false;
    ps._preview = false;
    ps.preview = false;
    delete ps._id;
    return ps;
}

function tuneForPlayerChild(ps) {
    ps.playOnLoad = false;
    ps.autoRemoveOnFinish = false;
    ps._preview = false;
    ps.preview = false;
    delete ps._id;
    return ps;
}

function writeFxPrefab(ps, ui) {
    const psCopy = tuneForSpawnPrefab(JSON.parse(JSON.stringify(ps)));
    const uiCopy = ui
        ? JSON.parse(JSON.stringify(ui))
        : {
              __type__: 'cc.UITransform',
              _name: '',
              _objFlags: 0,
              __editorExtras__: {},
              _enabled: true,
              _contentSize: { __type__: 'cc.Size', width: 100, height: 100 },
              _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
              _id: '',
          };

    const arr = [
        {
            __type__: 'cc.Prefab',
            _name: 'DamageParticleFX',
            _objFlags: 0,
            __editorExtras__: {},
            _native: '',
            data: { __id__: 1 },
            optimizationPolicy: 0,
            persistent: false,
        },
        {
            __type__: 'cc.Node',
            _name: 'DamageParticleFX',
            _objFlags: 0,
            __editorExtras__: {},
            _parent: null,
            _children: [],
            _active: true,
            _components: [{ __id__: 2 }, { __id__: 4 }],
            _prefab: { __id__: 6 },
            _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _mobility: 0,
            _layer: 33554432,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: '',
        },
    ];

    uiCopy.node = { __id__: 1 };
    uiCopy.__prefab = { __id__: 3 };
    if (!uiCopy._id) {
        uiCopy._id = '';
    }
    arr.push(uiCopy);
    arr.push({ __type__: 'cc.CompPrefabInfo', fileId: 'a1kDmG9pFXuiTransform01' });

    psCopy.node = { __id__: 1 };
    psCopy.__prefab = { __id__: 5 };
    if (!psCopy._id) {
        psCopy._id = '';
    }
    arr.push(psCopy);
    arr.push({ __type__: 'cc.CompPrefabInfo', fileId: 'b2kDmG9pFXparticleSys01' });
    arr.push({
        __type__: 'cc.PrefabInfo',
        root: { __id__: 1 },
        asset: { __id__: 0 },
        fileId: 'c3kDmG9pFXprefabRoot01',
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null,
    });

    fs.mkdirSync(path.dirname(fxPath), { recursive: true });
    fs.writeFileSync(fxPath, JSON.stringify(arr, null, 2));
}

function removePlayerDamageParticle(arr) {
    const names = new Set(['DamageParticle', 'Particle2D', 'DamageParticleFX']);
    const dpIdx = arr.findIndex(
        (x) =>
            x &&
            x.__type__ === 'cc.Node' &&
            x._parent &&
            x._parent.__id__ === 1 &&
            names.has(x._name),
    );
    if (dpIdx < 0) {
        return arr;
    }
    const toRemove = new Set([dpIdx]);
    for (let i = 0; i < arr.length; i++) {
        const x = arr[i];
        if (!x) continue;
        if (x.node && x.node.__id__ === dpIdx) toRemove.add(i);
        if (x.root && x.root.__id__ === dpIdx) toRemove.add(i);
    }
    const idMap = new Map();
    let ni = 0;
    for (let oi = 0; oi < arr.length; oi++) {
        if (!toRemove.has(oi)) {
            idMap.set(oi, ni++);
        }
    }
    function remap(v) {
        if (v === null || v === undefined) return v;
        if (Array.isArray(v)) return v.map(remap);
        if (typeof v !== 'object') return v;
        const out = {};
        for (const k of Object.keys(v)) {
            if (k === '__id__' && typeof v[k] === 'number') {
                const m = idMap.get(v[k]);
                out[k] = m !== undefined ? m : v[k];
            } else {
                out[k] = remap(v[k]);
            }
        }
        return out;
    }
    return arr.filter((_, i) => !toRemove.has(i)).map(remap);
}

function appendPlayerDamageParticle(arr, ps, ui) {
    arr = removePlayerDamageParticle(arr);
    const playerIdx = arr.findIndex((x) => x && x._name === 'Player' && x.__type__ === 'cc.Node');
    if (playerIdx < 0) throw new Error('Player node missing');

    const nodeIdx = arr.length;
    const uiIdx = nodeIdx + 1;
    const uiInfoIdx = nodeIdx + 2;
    const psIdx = nodeIdx + 3;
    const psInfoIdx = nodeIdx + 4;
    const prefabInfoIdx = nodeIdx + 5;

    const psCopy = tuneForPlayerChild(JSON.parse(JSON.stringify(ps)));
    const uiCopy = JSON.parse(
        JSON.stringify(
            ui || {
                __type__: 'cc.UITransform',
                _contentSize: { __type__: 'cc.Size', width: 100, height: 100 },
                _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
            },
        ),
    );

    arr[playerIdx]._children = arr[playerIdx]._children || [];
    arr[playerIdx]._children.push({ __id__: nodeIdx });

    arr.push({
        __type__: 'cc.Node',
        _name: 'DamageParticle',
        _objFlags: 0,
        __editorExtras__: {},
        _parent: { __id__: playerIdx },
        _children: [],
        _active: false,
        _components: [{ __id__: uiIdx }, { __id__: psIdx }],
        _prefab: { __id__: prefabInfoIdx },
        _lpos: { __type__: 'cc.Vec3', ...FX_OFFSET },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _mobility: 0,
        _layer: 33554432,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _id: '',
    });

    uiCopy.__type__ = 'cc.UITransform';
    uiCopy._name = '';
    uiCopy._objFlags = 0;
    uiCopy.__editorExtras__ = {};
    uiCopy.node = { __id__: nodeIdx };
    uiCopy._enabled = true;
    uiCopy.__prefab = { __id__: uiInfoIdx };
    delete uiCopy._id;
    arr.push(uiCopy);
    arr.push({ __type__: 'cc.CompPrefabInfo', fileId: '75Fgfc0UBNg77XcP9NAGXM' });

    psCopy.node = { __id__: nodeIdx };
    psCopy.__prefab = { __id__: psInfoIdx };
    arr.push(psCopy);
    arr.push({ __type__: 'cc.CompPrefabInfo', fileId: '7ciWJHAINKBqpsL/u0XEvw' });

    arr.push({
        __type__: 'cc.PrefabInfo',
        root: { __id__: nodeIdx },
        asset: { __id__: 0 },
        fileId: '85MsoUgx1GgL/YI3RKc/9q',
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null,
    });

    return arr;
}

const scene = loadJson(scenePath);
const { ps, ui } = findSceneDamageParticle(scene);
writeFxPrefab(ps, ui);
const player = appendPlayerDamageParticle(loadJson(playerPath), ps, ui);
fs.writeFileSync(playerPath, JSON.stringify(player, null, 2));
console.log('OK: DamageParticleFX + Player/DamageParticle restored from DamageParticleGO');
