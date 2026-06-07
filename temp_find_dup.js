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

const files = walk('assets');
const R = new Set([
  'cc.Sprite',
  'cc.Label',
  'cc.ParticleSystem2D',
  'cc.Mask',
  'cc.Graphics',
  'cc.UIRenderer',
]);
const lines = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byNode = new Map();
  for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o || !o.__type__ || !R.has(o.__type__)) continue;
    const nid = o.node && o.node.__id__;
    if (nid == null) continue;
    if (!byNode.has(nid)) byNode.set(nid, []);
    byNode.get(nid).push(`${o.__type__}@${i}`);
  }
  for (const [nid, comps] of byNode) {
    if (comps.length <= 1) continue;
    const node = j[nid];
    lines.push(`${f}: node ${nid} "${node && node._name}" -> ${comps.join(', ')}`);
  }
  for (const [nid, comps] of byNode) {
    const types = comps.map((c) => c.split('@')[0]);
    if (types.includes('cc.UIRenderer') && types.some((t) => t !== 'cc.UIRenderer')) {
      const node = j[nid];
      lines.push(
        `${f}: UIRenderer+OTHER node ${nid} "${node && node._name}" -> ${comps.join(', ')}`,
      );
    }
  }
}
fs.writeFileSync('temp_dup_out.txt', lines.join('\n') || 'none');
