const fs = require('fs');
const path = require('path');

const renderable = new Set([
    'cc.Sprite',
    'cc.Label',
    'cc.RichText',
    'cc.Mask',
    'cc.Graphics',
    'cc.UIRenderer',
]);

function scanFile(f) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const lines = [];
    const byNode = new Map();
    const badRefs = [];

    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o) continue;

        const nid = o.node && o.node.__id__;
        if (nid != null) {
            const node = j[nid];
            if (!node || node.__type__ !== 'cc.Node') {
                badRefs.push(
                    `${f}: comp ${i} ${o.__type__} -> idx ${nid} (${node?.__type__ ?? 'missing'})`,
                );
            }
        }

        if (!o.__type__ || !renderable.has(o.__type__)) continue;
        if (nid == null) {
            if (o.__type__ === 'cc.Sprite' && o.__editorExtras__?.mountedRoot) {
                lines.push(`${f}: orphan mounted Sprite@${i}`);
            }
            continue;
        }
        if (!byNode.has(nid)) byNode.set(nid, []);
        byNode.get(nid).push(`${o.__type__}@${i}`);
    }

    for (const [nid, comps] of byNode) {
        if (comps.length > 1) {
            lines.push(
                `${f}: DUP node ${nid} "${j[nid]?._name}" -> ${comps.join(', ')}`,
            );
        }
    }

    for (const n of badRefs) lines.push(n);

    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.__type__ !== 'cc.Node' || !o._components) continue;
        for (const c of o._components) {
            const comp = j[c.__id__];
            if (!comp || comp.__type__ === 'cc.Node') {
                lines.push(
                    `${f}: node ${i} "${o._name}" bad component ref ${c.__id__} (${comp?.__type__})`,
                );
            }
        }
    }

    return lines;
}

const f = 'assets/prefabs/Player.prefab';
const lines = scanFile(f);
console.log(lines.join('\n') || 'Player.prefab: no issues found');
console.log('entries', JSON.parse(fs.readFileSync(f, 'utf8')).length);
