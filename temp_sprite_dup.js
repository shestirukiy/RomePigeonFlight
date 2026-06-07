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
const lines = [];
for (const f of walk('assets')) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const sprites = new Map();
  const ui = new Set();
  for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o?.node) continue;
    const nid = o.node.__id__;
    if (o.__type__ === 'cc.Sprite') {
      if (!sprites.has(nid)) sprites.set(nid, []);
      sprites.get(nid).push(i);
    }
    if (o.__type__ === 'cc.UIRenderer') ui.add(nid);
  }
  for (const [nid, arr] of sprites) {
    if (arr.length > 1) lines.push(`${f}: ${arr.length} Sprites on ${j[nid]._name} (${nid})`);
    if (ui.has(nid)) lines.push(`${f}: UIRenderer+Sprite on ${j[nid]._name} (${nid})`);
  }
}
console.log(lines.join('\n') || 'none');
