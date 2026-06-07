const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/Test2.scene','utf8'));
function dump(id, d=0) {
  const n=j[id];
  if (!n || !n._name) return;
  const comps=(n._components||[]).map(c=>j[c.__id__].__type__).join(', ');
  console.log(' '.repeat(d*2)+id, n._name, comps);
  for (const c of n._children||[]) dump(c.__id__, d+1);
}
dump(148);
