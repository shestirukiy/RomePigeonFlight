const fs = require('fs');
const path = 'assets/Test2.scene';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

function findNode(name) {
    for (let i = 0; i < j.length; i++) {
        if (j[i]?.__type__ === 'cc.Node' && j[i]._name === name) return i;
    }
    return -1;
}

function setNodeRef(compIdx, nodeIdx) {
    const o = j[compIdx];
    if (!o) return;
    o.node = { __id__: nodeIdx };
}

function setNodeComponents(nodeIdx, compIdxs) {
    j[nodeIdx]._components = compIdxs.map((id) => ({ __id__: id }));
}

/* Remove orphan Graphics still targeting Label slot */
if (j[164]?.__type__ === 'cc.Graphics') {
    j[164]._enabled = false;
    j[164].node = null;
}

/* UI node */
const ui = findNode('UI');
if (ui >= 0) {
    setNodeComponents(ui, [122, 123, 124, 125, 126]);
    for (const id of [122, 123, 124, 125, 126]) setNodeRef(id, ui);
}

/* hp_Icon */
const hp = findNode('hp_Icon');
if (hp >= 0) {
    setNodeComponents(hp, [110, 111, 112, 113]);
    for (const id of [110, 111, 112, 113]) setNodeRef(id, hp);
}

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
console.log('fixed UI', ui, 'hp_Icon', hp, 'disabled graphics 164');
