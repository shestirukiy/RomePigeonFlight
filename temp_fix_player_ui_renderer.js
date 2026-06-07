const fs = require('fs');
const path = 'assets/prefabs/Player.prefab';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

const player = j[1];
const hasUiRenderer = player._components.some(
    (c) => j[c.__id__]?.__type__ === 'cc.UIRenderer',
);
if (hasUiRenderer) {
    console.log('UIRenderer already present');
    process.exit(0);
}

const uiIdx = j.length;
const infoIdx = uiIdx + 1;

j.push({
    __type__: 'cc.UIRenderer',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: 1 },
    _enabled: true,
    __prefab: { __id__: infoIdx },
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _id: '',
});

j.push({
    __type__: 'cc.CompPrefabInfo',
    fileId: 'a1UiRendererOnPlayerRoot01',
});

const sortPos = player._components.findIndex(
    (c) => j[c.__id__]?.__type__ === 'cc.Sorting2D',
);
if (sortPos >= 0) {
    player._components.splice(sortPos, 0, { __id__: uiIdx });
} else {
    player._components.push({ __id__: uiIdx });
}

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
console.log('Added UIRenderer@', uiIdx, 'before Sorting2D');
