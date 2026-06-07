const fs = require('fs');
const path = process.argv[2] || 'assets/prefabs/Player.prefab';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
const missing = [];

function walk(o, p = 'root') {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
        o.forEach((v, i) => walk(v, `${p}[${i}]`));
        return;
    }
    if (Object.prototype.hasOwnProperty.call(o, '__id__')) {
        const id = o.__id__;
        if (!j[id]) missing.push({ id, p });
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
}

walk(j[1]);
console.log('file', path, 'len', j.length, 'missing', missing.length);
missing.slice(0, 30).forEach((m) => console.log(m.id, m.p));
