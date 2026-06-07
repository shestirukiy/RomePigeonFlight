const fs = require('fs');
const path = 'assets/prefabs/Player.prefab';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

const removeIdx = new Set();
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (o && o.__type__ === 'cc.UIRenderer' && o.node && o.node.__id__ === 1) {
        removeIdx.add(i);
        if (o.__prefab && o.__prefab.__id__ != null) {
            removeIdx.add(o.__prefab.__id__);
        }
    }
}

if (removeIdx.size === 0) {
    console.log('No UIRenderer on Player root found');
    process.exit(0);
}

const player = j[1];
player._components = (player._components || []).filter(
    (c) => !removeIdx.has(c.__id__),
);

const remap = new Map();
let ni = 0;
for (let i = 0; i < j.length; i++) {
    if (removeIdx.has(i)) {
        continue;
    }
    remap.set(i, ni++);
}

const out = [];
for (let i = 0; i < j.length; i++) {
    if (removeIdx.has(i)) {
        continue;
    }
    out.push(JSON.parse(JSON.stringify(j[i], (k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '__id__')) {
            const mapped = remap.get(v.__id__);
            if (mapped == null) {
                throw new Error(`missing remap for __id__ ${v.__id__} at index ${i}`);
            }
            return { __id__: mapped };
        }
        return v;
    })));
}

fs.writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log('Removed UIRenderer from Player.prefab, deleted indices:', [...removeIdx].sort((a, b) => a - b));
