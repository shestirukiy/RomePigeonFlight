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

function walk(dir, acc = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else if (/\.(scene|prefab)$/.test(ent.name)) acc.push(p);
    }
    return acc;
}

function scanFile(f) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const byNode = new Map();
    const mounted = [];

    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o) continue;

        if (o.__type__ === 'cc.MountedComponentsInfo') {
            const target = o.targetInfo && o.targetInfo.__id__;
            const comps = (o.components || []).map((c) => c.__id__);
            mounted.push({ idx: i, target, comps });
        }

        if (!o.__type__ || !renderable.has(o.__type__)) continue;
        const nid = o.node && o.node.__id__;
        const info = {
            idx: i,
            type: o.__type__,
            nodeId: nid,
            nodeName: nid != null ? j[nid]?._name : null,
            mountedRoot: o.__editorExtras__?.mountedRoot?.__id__ ?? null,
            nodeNull: o.node == null,
        };
        if (nid != null) {
            if (!byNode.has(nid)) byNode.set(nid, []);
            byNode.get(nid).push(info);
        } else if (info.mountedRoot != null || o.__editorExtras__?.mountedRoot) {
            mounted.push({ idx: i, orphanSprite: info });
        }
    }

    const dupes = [];
    for (const [nid, comps] of byNode) {
        if (comps.length > 1) {
            dupes.push({ nid, name: j[nid]?._name, comps });
        }
    }

    if (dupes.length || mounted.length) {
        console.log('\n=== ' + f + ' ===');
        for (const d of dupes) {
            console.log(
                `  DUP node ${d.nid} "${d.name}": ${d.comps.map((c) => c.type + '@' + c.idx).join(', ')}`,
            );
        }
        for (const m of mounted) {
            if (m.orphanSprite) {
                console.log(
                    `  ORPHAN mounted ${m.orphanSprite.type}@${m.idx} mountedRoot=${m.orphanSprite.mountedRoot}`,
                );
            } else {
                const targetLocal =
                    m.target != null ? j[m.target]?.localID : null;
                const compTypes = (m.comps || [])
                    .map((cid) => `${j[cid]?.__type__}@${cid}`)
                    .join(', ');
                console.log(
                    `  MOUNTED @${m.idx} targetLocal=${JSON.stringify(targetLocal)} comps=${compTypes}`,
                );
                if (m.target != null && m.comps) {
                    for (const cid of m.comps) {
                        const co = j[cid];
                        if (co?.__type__ === 'cc.Sprite') {
                            console.log(
                                `    -> mounted Sprite@${cid} (check target node for existing Sprite)`,
                            );
                        }
                    }
                }
            }
        }
    }
}

for (const f of walk('assets')) scanFile(f);
