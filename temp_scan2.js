const fs = require('fs');
const path = require('path');
const renderable = new Set(['cc.Sprite', 'cc.Label', 'cc.RichText', 'cc.Mask', 'cc.Graphics', 'cc.UIRenderer']);

function walk(d, a = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, a);
        else if (/\.(scene|prefab)$/.test(e.name)) a.push(p);
    }
    return a;
}

const lines = [];
for (const f of walk('assets')) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const byNode = new Map();
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o || !renderable.has(o.__type__)) continue;
        const nid = o.node && o.node.__id__;
        if (nid == null) {
            if (o.__type__ === 'cc.Sprite' && o.__editorExtras__?.mountedRoot) {
                lines.push(`${f}: orphan mounted Sprite@${i} root=${o.__editorExtras__.mountedRoot.__id__}`);
            }
            continue;
        }
        if (!byNode.has(nid)) byNode.set(nid, []);
        byNode.get(nid).push(`${o.__type__}@${i}`);
    }
    for (const [nid, comps] of byNode) {
        if (comps.length > 1) {
            lines.push(`${f}: node ${nid} "${j[nid]?._name}" -> ${comps.join(', ')}`);
        }
    }
}
fs.writeFileSync('temp_scan2_out.txt', lines.join('\n') || 'none');
console.log(lines.join('\n') || 'none');
