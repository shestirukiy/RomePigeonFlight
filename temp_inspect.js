const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/prefabs/Player.prefab','utf8'));
for (const i of [84,91,93,96,2046]) {
  const o=j[i];
  if(o) console.log(i, o.__type__, o._name, o.node&&o.node.__id__);
}
// list all renderables
const R=new Set(['cc.Sprite','cc.Label','cc.ParticleSystem2D','cc.Mask','cc.Graphics','cc.UIRenderer']);
for(let i=0;i<j.length;i++){
  const o=j[i];
  if(!o||!R.has(o.__type__))continue;
  const n=j[o.node.__id__];
  console.log('R', i, o.__type__, 'on', o.node.__id__, n&&n._name);
}
