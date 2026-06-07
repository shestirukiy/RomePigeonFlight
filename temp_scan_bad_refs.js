const fs = require('fs');
const path = require('path');

function walk(d, a = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, a);
        else if (/\.(scene|prefab)$/.test(e.name)) a.push(p);
    }
    return a;
}

const bad = [];
for (const f of walk('assets')) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        const nid = o?.node?.__id__;
        if (nid == null) continue;
        const node = j[nid];
        if (!node || node.__type__ !== 'cc.Node') {
            bad.push(`${f}: comp ${i} ${o.__type__} -> idx ${nid} (${node?.__type__ ?? 'missing'})`);
        }
    }
}
console.log(bad.join('\n') || 'all node refs ok');
