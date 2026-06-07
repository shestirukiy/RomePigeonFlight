const fs = require('fs');
const path = 'assets/Test2.scene';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

function findNode(name) {
    for (let i = 0; i < j.length; i++) {
        if (j[i]?.__type__ === 'cc.Node' && j[i]._name === name) return i;
    }
    return -1;
}

function componentsOnNode(nodeIdx, types) {
    const out = [];
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o || o.node?.__id__ !== nodeIdx) continue;
        if (types.includes(o.__type__)) out.push(i);
    }
    return out.sort((a, b) => a - b);
}

function wireNode(nodeIdx, orderedTypes) {
    const picked = [];
    const used = new Set();
    for (const t of orderedTypes) {
        for (let i = 0; i < j.length; i++) {
            const o = j[i];
            if (used.has(i)) continue;
            if (o?.node?.__id__ !== nodeIdx) continue;
            if (o.__type__ !== t) continue;
            o.node = { __id__: nodeIdx };
            picked.push(i);
            used.add(i);
            break;
        }
    }
    j[nodeIdx]._components = picked.map((id) => ({ __id__: id }));
    return picked;
}

function detachWrong(nodeIdx, allowedIds) {
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o?.node || o.node.__id__ !== nodeIdx) continue;
        if (allowedIds.has(i)) continue;
        o.node = null;
        o._enabled = false;
    }
}

function wireComponent(compIdx, nodeIdx) {
    if (compIdx < 0 || !j[compIdx]) return;
    j[compIdx].node = { __id__: nodeIdx };
    j[compIdx]._enabled = true;
}

function setNodeComponents(nodeIdx, compIds) {
    j[nodeIdx]._components = compIds.map((id) => ({ __id__: id }));
}

function findOrphan(type, matchFn) {
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (!o || o.__type__ !== type) continue;
        if (o.node?.__id__ != null) continue;
        if (matchFn && !matchFn(o)) continue;
        return i;
    }
    return -1;
}

function firstOnNode(nodeIdx, type) {
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.__type__ === type && o.node?.__id__ === nodeIdx) return i;
    }
    return -1;
}

/* Player mounted sprite */
for (const o of j) {
    if (o?.__type__ === 'cc.PrefabInstance' && o.fileId === 'aa77qQ+6RLS69kfmnhOqCx') {
        o.mountedComponents = [];
    }
    if (o?.__type__ === 'cc.Sprite' && o.__editorExtras__?.mountedRoot) {
        o._enabled = false;
        o.node = null;
        delete o.__editorExtras__.mountedRoot;
    }
}

/* MilestoneSign */
const ms = findNode('MilestoneSign');
if (ms >= 0) {
    const allowed = wireNode(ms, [
        'cc.UITransform',
        'cc.RigidBody2D',
        'cc.BoxCollider2D',
        'b8d4fKhbD5Pm40gHlp8m08y',
        'a8c3eHym01Kbo8BLVx7njpB',
        'cc.Mask',
    ]);
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.node?.__id__ === ms && o.__type__ === 'cc.Graphics') {
            o.node = null;
            o._enabled = false;
        }
    }
    detachWrong(ms, new Set(allowed));
}

/* UI */
const ui = findNode('UI');
if (ui >= 0) {
    delete j[ui].node;
    delete j[ui]._enabled;

    let uiTransform = firstOnNode(ui, 'cc.UITransform');
    if (uiTransform < 0) uiTransform = findOrphan('cc.UITransform');
    const widget = firstOnNode(ui, 'cc.Widget');
    const portrait = firstOnNode(ui, 'c7e41qSj11LLppjHQ6PS2wh');
    let uiRenderer = firstOnNode(ui, 'cc.UIRenderer');
    if (uiRenderer < 0) uiRenderer = findOrphan('cc.UIRenderer');
    const sorting = firstOnNode(ui, 'cc.Sorting2D');
    const animation = firstOnNode(ui, 'cc.Animation');

    const allowed = [uiTransform, widget, portrait, uiRenderer, sorting, animation].filter(
        (id) => id >= 0,
    );
    for (const id of allowed) wireComponent(id, ui);
    setNodeComponents(ui, allowed);
    detachWrong(ui, new Set(allowed));
}

/* seedLabel */
const seedLabel = findNode('seedLabel');
if (seedLabel >= 0) {
    let ut = findOrphan(
        'cc.UITransform',
        (o) => o._contentSize?.width === 100 && o._contentSize?.height === 100,
    );
    if (ut < 0) ut = findOrphan('cc.UITransform');
    let label = findOrphan('cc.Label', (o) => o._id === '4aBZiFmwRFFKrJzwxEtJNQ');
    if (label < 0) label = findOrphan('cc.Label');
    let sort = findOrphan(
        'cc.Sorting2D',
        (o) => o._sortingOrder === 20 && o._id === '8fOwmm8phFUZjW0F9qa/9I',
    );
    if (sort < 0) sort = findOrphan('cc.Sorting2D', (o) => o._sortingOrder === 20);

    const allowed = [ut, label, sort].filter((id) => id >= 0);
    for (const id of allowed) wireComponent(id, seedLabel);
    setNodeComponents(seedLabel, allowed);
    detachWrong(seedLabel, new Set(allowed));
}

/* hp_Icon */
const hp = findNode('hp_Icon');
if (hp >= 0) {
    const allowed = wireNode(hp, [
        'cc.UITransform',
        'cc.Sprite',
        'cc.Sorting2D',
        'cc.Animation',
    ]);
    detachWrong(hp, new Set(allowed));
}

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');

const renderable = new Set([
    'cc.Sprite',
    'cc.Label',
    'cc.RichText',
    'cc.Mask',
    'cc.Graphics',
    'cc.UIRenderer',
]);
const byNode = new Map();
for (let i = 0; i < j.length; i++) {
    const o = j[i];
    if (!o || !renderable.has(o.__type__)) continue;
    const nid = o.node && o.node.__id__;
    if (nid == null) continue;
    if (!byNode.has(nid)) byNode.set(nid, []);
    byNode.get(nid).push(`${o.__type__}@${i}`);
}
let dupes = 0;
for (const [nid, comps] of byNode) {
    if (comps.length > 1) {
        dupes++;
        console.log(`DUP node ${nid} "${j[nid]?._name}": ${comps.join(', ')}`);
    }
}
console.log(dupes ? 'still has dupes' : 'Test2.scene OK');

/* UI subtree validation */
function validateUiSubtree() {
    const uiIdx = findNode('UI');
    if (uiIdx < 0) {
        console.log('UI node not found');
        return;
    }
    const walk = [uiIdx, ...(j[uiIdx]._children || []).map((c) => c.__id__)];
    let ok = true;
    for (const nid of walk) {
        const node = j[nid];
        const comps = node._components || [];
        for (const cref of comps) {
            const cid = cref.__id__;
            const comp = j[cid];
            const ref = comp?.node?.__id__;
            if (ref !== nid) {
                ok = false;
                console.log(
                    `MISMATCH node ${nid} "${node._name}" comp ${cid} ${comp?.__type__} -> node ${ref}`,
                );
            }
            if (comp?.__type__ === 'cc.Label' && ref == null) {
                ok = false;
                console.log(`NULL Label@${cid} still listed on "${node._name}"`);
            }
        }
        if (node._name === 'UI') {
            const types = comps.map((c) => j[c.__id__]?.__type__);
            const uiR = types.indexOf('cc.UIRenderer');
            const sort = types.indexOf('cc.Sorting2D');
            if (uiR < 0 || sort < 0 || uiR >= sort) {
                ok = false;
                console.log(`UI component order bad: ${types.join(', ')}`);
            }
        }
        console.log(
            `${node._name} (${nid}): ${comps.map((c) => `${j[c.__id__]?.__type__}@${c.__id__}`).join(', ')}`,
        );
    }
    console.log(ok ? 'UI subtree OK' : 'UI subtree HAS ISSUES');
}

validateUiSubtree();
