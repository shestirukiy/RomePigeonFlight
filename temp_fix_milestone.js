const fs = require('fs');
const path = 'assets/Test2.scene';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

let milestoneNodeIdx = -1;
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (o?.__type__ === 'cc.Node' && o._name === 'MilestoneSign') {
        milestoneNodeIdx = i;
        break;
    }
}
if (milestoneNodeIdx < 0) {
    console.error('MilestoneSign node not found');
    process.exit(1);
}

const milestoneNode = j[milestoneNodeIdx];
const wantedTypes = new Set([
    'cc.UITransform',
    'cc.RigidBody2D',
    'cc.BoxCollider2D',
    'b8d4fKhbD5Pm40gHlp8m08y',
    'a8c3eHym01Kbo8BLVx7njpB',
    'cc.Mask',
]);

const compIds = [];
const removeGraphics = [];

for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o?.node || o.node.__id__ === milestoneNodeIdx) {
        /* already correct */
    } else if (
        o.node.__id__ !== milestoneNodeIdx &&
        wantedTypes.has(o.__type__) &&
        /* components wrongly attached to another object id that belongs to this sign setup */
        (o.__type__ !== 'cc.Mask' || o._type === 0)
    ) {
        /* find orphans: MilestoneSign components pointing at wrong node id */
    }
}

/* Collect components that belong on MilestoneSign but reference wrong node id */
const wrongNodeIds = new Set();
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o?.node || typeof o.node.__id__ !== 'number') continue;
    if (o.node.__id__ === milestoneNodeIdx) {
        compIds.push(i);
        continue;
    }
    const t = o.__type__;
    if (
        t === 'cc.UITransform' ||
        t === 'cc.RigidBody2D' ||
        t === 'cc.BoxCollider2D' ||
        t === 'b8d4fKhbD5Pm40gHlp8m08y' ||
        t === 'a8c3eHym01Kbo8BLVx7njpB' ||
        t === 'cc.Mask'
    ) {
        const target = j[o.node.__id__];
        if (target?.__type__ === 'cc.Label') {
            wrongNodeIds.add(o.node.__id__);
            o.node.__id__ = milestoneNodeIdx;
            compIds.push(i);
        }
    }
    if (t === 'cc.Graphics') {
        const target = j[o.node.__id__];
        if (target?.__type__ === 'cc.Label') {
            removeGraphics.push(i);
        }
    }
}

/* Remove redundant Graphics when Mask is RECT on same node */
const hasMask = compIds.some((id) => j[id]?.__type__ === 'cc.Mask');
if (hasMask) {
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (
            o?.__type__ === 'cc.Graphics' &&
            o.node?.__id__ === milestoneNodeIdx
        ) {
            removeGraphics.push(i);
        }
    }
}

const removeSet = new Set(removeGraphics);
const finalCompIds = compIds
    .filter((id) => !removeSet.has(id))
    .sort((a, b) => a - b);

milestoneNode._components = finalCompIds.map((id) => ({ __id__: id }));

/* Drop removed graphics from any node component lists */
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o?._components) continue;
    o._components = o._components.filter((c) => !removeSet.has(c.__id__));
}

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
console.log(
    'Fixed MilestoneSign node',
    milestoneNodeIdx,
    'components:',
    finalCompIds.join(','),
    'removed Graphics:',
    [...removeSet].join(','),
    'wrong node ids rewired from:',
    [...wrongNodeIds].join(','),
);
