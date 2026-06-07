const fs = require('fs');
const path = process.argv[2];
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log('file', path, 'len', j.length);
const missing = [];
function walk(o, p = 'root') {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
        o.forEach((v, i) => walk(v, `${p}[${i}]`));
        return;
    }
    if (Object.prototype.hasOwnProperty.call(o, '__id__')) {
        const id = o.__id__;
        if (!j[id]) missing.push({ p, id });
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
}
walk(j[1]);
console.log('missing', missing.length);
missing.slice(0, 40).forEach((m) => console.log(m.id, m.p));
const canvas = j.find(
    (o) =>
        o &&
        o.__type__ === 'cc.Node' &&
        o._name === 'Canvas' &&
        o._parent &&
        o._parent.__id__ === 1,
);
console.log('canvas idx', j.indexOf(canvas));
(canvas._components || []).forEach((c) => {
    const comp = j[c.__id__];
    console.log(' comp', c.__id__, comp ? comp.__type__ : 'MISSING');
});
