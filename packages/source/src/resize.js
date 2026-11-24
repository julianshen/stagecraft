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
    const slides = new Map(baseline.slides.map(slide => [slide.id, slide]));
    const masters = new Map(baseline.masters.map(master => [master.id, master]));
    const themes = new Map(baseline.themes.map(theme => [theme.id, theme]));
    const defaultsByLayout = new Map(baseline.layouts.map(layout => [layout.id,
        themes.get(masters.get(layout.masterId)?.themeId)?.extensions?.pptxObjectDefaults]));
    const objects = new Map(), defaultsByObject = new Map();
    for (const slide of snapshot.slides) for (const object of slide.objects) {
        if (objects.has(object.id)) invalid();
        objects.set(object.id, object);
        // New slides use the writer's first retained layout; existing slides keep their own.
        const retainedSlide = slides.get(slide.id);
        const layoutId = retainedSlide ? retainedSlide.layoutId : baseline.layouts[0]?.id;
        defaultsByObject.set(object.id, defaultsByLayout.get(layoutId));
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
        } else if (object.source || object.extensions?.stagecraftAuthored !== true
            || defaultsByObject.get(id)?.[object.type === 'text' ? 'txDef' : 'spDef']) invalid();
        const growth = height - g.height;
        const offset = layout.anchor === 'bottom' ? growth : layout.anchor === 'middle' ? Math.floor(growth / 2) : 0;
        const y = g.y - offset;
        if (!Number.isSafeInteger(y)) invalid();
        patches.push({ object, geometry: { ...g, y, height } });
    }
    for (const { object, geometry } of patches) object.geometry = geometry;
}
