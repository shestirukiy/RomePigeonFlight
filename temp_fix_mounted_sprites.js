const fs = require('fs');
const path = require('path');

const apply = process.argv.includes('--apply');
const onlyFile = process.argv.find((a) => a.startsWith('--file='))?.slice(7) ?? null;

function walk(dir, acc = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else if (/\.(scene|prefab)$/.test(ent.name)) acc.push(p);
    }
    return acc;
}

function getSpriteLocalIds(j) {
    const nodeToFileId = new Map();
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.__type__ === 'cc.Node' && o._prefab?.__id__ != null) {
            const pi = j[o._prefab.__id__];
            if (pi?.fileId) nodeToFileId.set(i, pi.fileId);
        }
    }
    const set = new Set();
    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.__type__ === 'cc.Sprite' && o.node?.__id__ != null) {
            const fid = nodeToFileId.get(o.node.__id__);
            if (fid) set.add(fid);
        }
    }
    return set;
}

function collectPrefabSpriteData(assetsDir) {
    const localIdToPrefabUuid = new Map();
    const uuidToSpriteLocalIds = new Map();

    function walkPrefabs(dir) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walkPrefabs(p);
                continue;
            }
            if (!ent.name.endsWith('.prefab')) continue;

            const metaPath = `${p}.meta`;
            if (!fs.existsSync(metaPath)) continue;
            const uuid = JSON.parse(fs.readFileSync(metaPath, 'utf8')).uuid;
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            const spriteIds = getSpriteLocalIds(j);
            uuidToSpriteLocalIds.set(uuid, spriteIds);

            for (let i = 0; i < j.length; i++) {
                const o = j[i];
                if (o?.__type__ === 'cc.PrefabInfo' && o.fileId) {
                    localIdToPrefabUuid.set(o.fileId, uuid);
                }
            }
        }
    }

    walkPrefabs(assetsDir);
    return { localIdToPrefabUuid, uuidToSpriteLocalIds };
}

function getPrefabUuidFromNode(j, nodeIdx) {
    let cur = j[nodeIdx];
    while (cur) {
        if (cur._prefab?.__id__ != null) {
            const pi = j[cur._prefab.__id__];
            if (pi?.asset?.__uuid__) return pi.asset.__uuid__;
        }
        if (!cur._parent?.__id__) break;
        cur = j[cur._parent.__id__];
    }
    return null;
}

function countRefs(j, idx, skip = new Set()) {
    let count = 0;
    for (let i = 0; i < j.length; i++) {
        if (skip.has(i) || i === idx) continue;
        if (JSON.stringify(j[i]).includes(`"__id__": ${idx}`)) count++;
    }
    return count;
}

function isOrphanMountedSprite(comp) {
    return (
        comp?.__type__ === 'cc.Sprite' &&
        comp.node == null &&
        (comp.__editorExtras__?.mountedRoot != null || comp.__prefab == null)
    );
}

function findRemovals(j, localIdToPrefabUuid, uuidToSpriteLocalIds) {
    const removeIdx = new Set();
    const logs = [];

    for (let i = 0; i < j.length; i++) {
        const o = j[i];
        if (o?.__type__ !== 'cc.MountedComponentsInfo') continue;

        const targetIdx = o.targetInfo?.__id__;
        const target = targetIdx != null ? j[targetIdx] : null;
        const localIds =
            target?.__type__ === 'cc.TargetInfo' ? target.localID || [] : [];
        if (!localIds.length) continue;

        const compIds = (o.components || []).map((c) => c.__id__);
        if (!compIds.length) continue;

        const orphanSprites = compIds.filter((cid) =>
            isOrphanMountedSprite(j[cid]),
        );
        if (!orphanSprites.length || orphanSprites.length !== compIds.length) {
            continue;
        }

        let prefabUuid = null;
        for (const cid of orphanSprites) {
            const rootIdx = j[cid].__editorExtras__?.mountedRoot?.__id__;
            if (rootIdx != null) {
                prefabUuid = getPrefabUuidFromNode(j, rootIdx);
                if (prefabUuid) break;
            }
        }
        if (!prefabUuid) {
            prefabUuid = localIdToPrefabUuid.get(localIds[0]) ?? null;
        }

        const spriteLocalIds = prefabUuid
            ? uuidToSpriteLocalIds.get(prefabUuid)
            : null;
        const shouldRemove = localIds.every((lid) => spriteLocalIds?.has(lid));
        if (!shouldRemove) {
            logs.push(
                `  SKIP mount@${i} localIDs=${JSON.stringify(localIds)} prefab=${prefabUuid ?? 'unknown'}`,
            );
            continue;
        }

        removeIdx.add(i);
        for (const cid of compIds) removeIdx.add(cid);
        if (targetIdx != null && countRefs(j, targetIdx, removeIdx) === 0) {
            removeIdx.add(targetIdx);
        }

        logs.push(
            `  REMOVE mount@${i} targetLocal=${JSON.stringify(localIds)} sprites=${orphanSprites.join(',')} prefab=${prefabUuid}`,
        );
    }

    return { removeIdx, logs };
}

function applyRemovals(j, removeIdx) {
    const cleaned = JSON.parse(JSON.stringify(j));
    for (let i = 0; i < cleaned.length; i++) {
        if (removeIdx.has(i)) continue;
        const o = cleaned[i];
        if (o?.__type__ === 'cc.PrefabInstance' && Array.isArray(o.mountedComponents)) {
            o.mountedComponents = o.mountedComponents.filter(
                (c) => !removeIdx.has(c.__id__),
            );
        }
    }

    const remap = new Map();
    let ni = 0;
    for (let i = 0; i < cleaned.length; i++) {
        if (removeIdx.has(i)) continue;
        remap.set(i, ni++);
    }

    const out = [];
    for (let i = 0; i < cleaned.length; i++) {
        if (removeIdx.has(i)) continue;
        out.push(
            JSON.parse(
                JSON.stringify(cleaned[i], (k, v) => {
                    if (
                        v &&
                        typeof v === 'object' &&
                        !Array.isArray(v) &&
                        Object.prototype.hasOwnProperty.call(v, '__id__')
                    ) {
                        const mapped = remap.get(v.__id__);
                        if (mapped == null) {
                            throw new Error(
                                `missing remap for __id__ ${v.__id__} at index ${i}`,
                            );
                        }
                        return { __id__: mapped };
                    }
                    return v;
                }),
            ),
        );
    }
    return out;
}

const { localIdToPrefabUuid, uuidToSpriteLocalIds } =
    collectPrefabSpriteData('assets');

const files = onlyFile ? [onlyFile] : walk('assets');
let totalRemoved = 0;

for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const { removeIdx, logs } = findRemovals(
        j,
        localIdToPrefabUuid,
        uuidToSpriteLocalIds,
    );
    if (!logs.length) continue;

    console.log(`\n=== ${f} ===`);
    for (const line of logs) console.log(line);

    if (removeIdx.size === 0) continue;

    totalRemoved += removeIdx.size;
    console.log(
        `  -> delete ${removeIdx.size} objects: [${[...removeIdx].sort((a, b) => a - b).join(', ')}]`,
    );

    if (apply) {
        const out = applyRemovals(j, removeIdx);
        fs.writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
        console.log('  -> written');
    }
}

if (!totalRemoved) {
    console.log('\nNo redundant mounted Sprites found.');
} else if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
}
