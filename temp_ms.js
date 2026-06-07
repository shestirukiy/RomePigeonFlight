const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/Test2.scene','utf8'));
const n=j[148];
console.log('148', n._name, 'comps:');
for (const c of n._components||[]) console.log(' ', j[c.__id__].__type__);
