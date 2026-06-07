const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/prefabs/Player.prefab','utf8'));
for (const id of [97,84,96,1]) {
  const n=j[id];
  console.log('\n===', id, n._name, '===');
  for (const c of n._components||[]) {
    const o=j[c.__id__];
    console.log(' ', c.__id__, o.__type__);
  }
}
