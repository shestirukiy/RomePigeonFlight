const fs = require('fs');
const path = require('path');
function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.prefab') || ent.name.endsWith('.scene')) acc.push(p);
  }
  return acc;
}
const R = new Set([
  'cc.Sprite',
  'cc.Label',
  'cc.ParticleSystem2D',
  'cc.Mask',
  'cc.Graphics',
  'cc.UIRenderer',
]);
const lines = [];
for (const f of walk('assets')) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const sorting = new Map();
  const render = new Map();
  for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o || !o.node) continue;
    const nid = o.node.__id__;
    if (o.__type__ === 'cc.Sorting2D') {
      if (!sorting.has(nid)) sorting.set(nid, []);
      sorting.get(nid).push(i);
    }
    if (R.has(o.__type__)) {
      if (!render.has(nid)) render.set(nid, []);
      render.get(nid).push(o.__type__ + '@' + i);
    }
  }
  for (const [nid, s] of sorting) {
    const r = render.get(nid);
    if (!r) {
      const node = j[nid];
      lines.push(`${f}: Sorting2D-only "${node && node._name}" node ${nid}`);
    } else {
      const node = j[nid];
      lines.push(
        `${f}: Sorting2D+render "${node && node._name}" node ${nid} -> ${r.join(', ')}`,
      );
    }
  }
}
fs.writeFileSync('temp_sort_out.txt', lines.join('\n'));
