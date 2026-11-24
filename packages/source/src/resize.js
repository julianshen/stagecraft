const invalid = () => { throw new Error('Invalid resize measurement'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Apply transient geometry only to the export clone; native permission comes from the private baseline. */
export function applyResize(snapshot, baseline, input, format) {
    if (input === undefined) return;
    if (!(input instanceof Map) && !record(input)) invalid();
    const entries = input instanceof Map ? [...input] : Reflect.ownKeys(input).map(key => [key, input[key]]);
    if (!entries.length) return;
    if (format !== 'pptx') invalid();
    const retained = new Map();
    const collect = objects => { for (const object of objects ?? []) { retained.set(object.id, object); collect(object.children); } };
    for (const owner of [...baseline.slides, ...baseline.layouts, ...baseline.masters]) collect(owner.objects);
    const objects = new Map();
    for (const slide of snapshot.slides) for (const object of slide.objects) {
        if (objects.has(object.id)) invalid();
        objects.set(object.id, object);
    }
    const patches = [];
    for (const [id, value] of entries) {
        if (typeof id !== 'string' || !record(value) || !Object.hasOwn(value, 'height') || Reflect.ownKeys(value).some(key => key !== 'height')) invalid();
        const height = value.height, object = objects.get(id), original = retained.get(id);
        if (!object || !Number.isSafeInteger(height) || height <= 0) invalid();
        const g = object.geometry, layout = object.bodyLayout;
        if (!['text', 'shape'].includes(object.type) || !object.text || object.children?.length
            || object.shape && object.shape !== 'rect' || layout?.autofit !== 'resize'
            || layout.wrap === 'none' || layout.anchor !== undefined && !['top', 'middle', 'bottom'].includes(layout.anchor)
            || !g || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(g[key]))
            || g.width <= 0 || g.height <= 0 || (g.rotation ?? 0) !== 0 || g.flipH || g.flipV || height < g.height) invalid();
        if (original) {
            if (original.source?.format !== 'pptx' || original.extensions?.editableGeometry !== true
                || original.extensions?.pptxTextMetrics?.supported !== true) invalid();
        } else if (object.source || object.extensions?.stagecraftAuthored !== true) invalid();
        const growth = height - g.height;
        const offset = layout.anchor === 'bottom' ? growth : layout.anchor === 'middle' ? Math.floor(growth / 2) : 0;
        const y = g.y - offset;
        if (!Number.isSafeInteger(y)) invalid();
        patches.push({ object, geometry: { ...g, y, height } });
    }
    for (const { object, geometry } of patches) object.geometry = geometry;
}
