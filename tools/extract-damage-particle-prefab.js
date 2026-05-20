const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const playerPath = path.join(root, 'assets/prefabs/Player.prefab');
const outDir = path.join(root, 'assets/prefabs/fx');
const outPath = path.join(outDir, 'DamageParticleFX.prefab');

const arr = JSON.parse(fs.readFileSync(playerPath, 'utf8'));
const dpIdx = arr.findIndex(
    (x) =>
        x &&
        x.__type__ === 'cc.Node' &&
        x._parent &&
        x._parent.__id__ === 1 &&
        (x._name === 'DamageParticle' ||
            x._name === 'Particle2D' ||
            x._name === 'DamageParticleFX'),
);
if (dpIdx < 0) {
    console.log('Damage particle node already removed from Player.prefab');
    process.exit(0);
}

const toRemove = new Set([dpIdx]);
for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (!x) {
        continue;
    }
    if (x.node && x.node.__id__ === dpIdx) {
        toRemove.add(i);
    }
    if (x.root && x.root.__id__ === dpIdx) {
        toRemove.add(i);
    }
}
for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (
        x &&
        x.__type__ === 'cc.CompPrefabInfo' &&
        (x.fileId === '75Fgfc0UBNg77XcP9NAGXM' ||
            x.fileId === '7ciWJHAINKBqpsL/u0XEvw')
    ) {
        toRemove.add(i);
    }
}
for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x && x.__type__ === 'cc.PrefabInfo' && x.fileId === '85MsoUgx1GgL/YI3RKc/9q') {
        toRemove.add(i);
    }
}

function remapIds(val, idMap) {
    if (val === null || val === undefined) {
        return val;
    }
    if (Array.isArray(val)) {
        return val.map((v) => remapIds(v, idMap));
    }
    if (typeof val !== 'object') {
        return val;
    }
    const out = {};
    for (const key of Object.keys(val)) {
        if (key === '__id__' && typeof val[key] === 'number') {
            const mapped = idMap.get(val[key]);
            out[key] = mapped !== undefined ? mapped : val[key];
        } else {
            out[key] = remapIds(val[key], idMap);
        }
    }
    return out;
}

const idMap = new Map();
let newIdx = 0;
for (let oldIdx = 0; oldIdx < arr.length; oldIdx++) {
    if (!toRemove.has(oldIdx)) {
        idMap.set(oldIdx, newIdx);
        newIdx++;
    }
}

const filtered = arr
    .filter((_, i) => !toRemove.has(i))
    .map((entry) => remapIds(entry, idMap));

const playerNode = filtered.find((x) => x && x._name === 'Player');
if (!playerNode) {
    throw new Error('Player root node not found');
}
playerNode._children = [{ __id__: idMap.get(2) ?? 2 }];

const anim = filtered.find((x) => x && x.__type__ === 'c2b8aPhbU9CwZ4qfwHU6LXD');
if (anim) {
    delete anim.damageParticleNode;
}

const scenePath = path.join(root, 'assets/Main.scene');
if (fs.existsSync(scenePath)) {
    console.log(
        'Tip: run node tools/restore-damage-particle-from-scene.js to sync FX from DamageParticleGO',
    );
}

if (!fs.existsSync(outPath)) {
    const psEntry = arr.find(
        (x) =>
            x &&
            x.__type__ === 'cc.ParticleSystem2D' &&
            x.node &&
            x.node.__id__ === dpIdx,
    );
    const uiEntry = arr.find(
        (x) =>
            x &&
            x.__type__ === 'cc.UITransform' &&
            x.node &&
            x.node.__id__ === dpIdx,
    );
    const ps = JSON.parse(JSON.stringify(psEntry));
    const ui = JSON.parse(JSON.stringify(uiEntry));
    ps.autoRemoveOnFinish = true;
    ps.playOnLoad = false;
    ps._preview = false;
    ps.preview = false;

    const newArr = [
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
    ui.node = { __id__: 1 };
    ui.__prefab = { __id__: 3 };
    ui._id = ui._id ?? '';
    newArr.push(ui);
    newArr.push({ __type__: 'cc.CompPrefabInfo', fileId: 'a1kDmG9pFXuiTransform01' });
    ps.node = { __id__: 1 };
    ps.__prefab = { __id__: 5 };
    ps._id = ps._id ?? '';
    newArr.push(ps);
    newArr.push({ __type__: 'cc.CompPrefabInfo', fileId: 'b2kDmG9pFXparticleSys01' });
    newArr.push({
        __type__: 'cc.PrefabInfo',
        root: { __id__: 1 },
        asset: { __id__: 0 },
        fileId: 'c3kDmG9pFXprefabRoot01',
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null,
    });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(newArr, null, 2));
}

fs.writeFileSync(playerPath, JSON.stringify(filtered, null, 2));
console.log('OK Player cleaned, removed', toRemove.size, 'entries');
