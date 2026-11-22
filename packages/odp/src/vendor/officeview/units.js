// Adapted from officeview src/odf/units.ts, dc73bda86e07e9ed0317cb9f91781cce14a39b21.
// Copyright (c) 2026 Julian Shen. MIT license: ./LICENSE.
// Narrow EMU conversion only; syntax tightened to reject malformed decimal values.
export function lengthEmu(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(cm|mm|in|pt|pc|px)?$/i.exec(value.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  const factor = { cm: 914400 / 2.54, mm: 914400 / 25.4, in: 914400, pt: 914400 / 72, pc: 914400 / 6, px: 914400 / 96 };
  const result = n * factor[(match[2] ?? 'px').toLowerCase()];
  return Number.isFinite(result) ? result : undefined;
}
