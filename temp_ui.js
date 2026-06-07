const fs=require('fs');
const j=JSON.parse(fs.readFileSync('assets/Test2.scene','utf8'));
for (const id of [104,105,110,114]) {
  const n=j[id];
  console.log(id, n._name, 'parent', n._parent&&n._parent.__id__, 'children', (n._children||[]).map(c=>j[c.__id__]._name));
}
