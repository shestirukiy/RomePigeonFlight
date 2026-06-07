const fs = require('fs');
const path = process.argv[2];
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
const renderable = new Set([
    'cc.Sprite',
    'cc.Label',
    'cc.RichText',
    'cc.Mask',
    'cc.Graphics',
]);
const byNode = new Map();
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o || !o.__type__ || !renderable.has(o.__type__)) continue;
    const nid = o.node && o.node.__id__;
    if (nid == null) continue;
    if (!byNode.has(nid)) byNode.set(nid, []);
    byNode.get(nid).push({ idx: i, type: o.__type__ });
}
for (const [nid, comps] of byNode.entries()) {
    if (comps.length <= 1) continue;
    const node = j[nid];
    console.log(
        `node ${nid} "${node && node._name}" -> ${comps.map((c) => c.type + '@' + c.idx).join(', ')}`,
    );
}
