const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/Test2.scene','utf8'));
const n=j[104];
console.log('node104', JSON.stringify({name:n._name, comps:n._components, children:n._children},null,2));
for (const cid of n._components||[]) {
  const c=j[cid.__id__];
  console.log(' comp', cid.__id__, c.__type__);
}
