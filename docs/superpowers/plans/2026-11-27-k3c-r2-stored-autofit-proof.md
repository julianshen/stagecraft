# K3c-R2 Stored Autofit Proof Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain partial native `normAutofit` values, add shrink/resize fit bindings and strict proof validation, and invalidate proofs on text/width/height edits without changing export measurement or renderer behavior.

**Architecture:** Source reads only actually present `normAutofit` attributes into `bodyLayout.fit`. Core derives effective values through an evidence-gated policy helper, adds a fixed-size text/width/height binding in the appearance input, validates partial fit, and treats binding mismatches as stale. R2 ships strict-by-default (`NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED = false`); R3 enables schema defaults only after Codex’s native evidence. Core commands remove autofit proofs on fit-determining edits while preserving them for x/y/rotation-only moves.

**Tech Stack:** ES modules, Vitest, TypeScript declaration tests, existing core editor transaction/undo stack, existing PPTX source reader/writer.

**Contract:** `/Users/julianshen/prj/stagecraft-coord/contracts/konva-3c.md` rev 2.

**Merge gate:** R2 does not merge before K3c-R1 renderer display support. R2 itself keeps absent-attribute defaults disabled and may merge only strict behavior after R1. R3 enables defaults only after Codex’s §8 native evidence and reruns the histogram. If R2 is ready first, it waits for R1. No renderer files are touched here.

---

## File map

| File | Responsibility |
|---|---|
| `packages/source/src/authoring.js` | Read partial `normAutofit` fit; preserve writer’s present-attribute-only behavior. |
| `packages/source/src/nativeAppearance.js` | Validate raw autofit XML, allow supported autofit text, emit proofs only for valid stored/effective fit. |
| `packages/core/src/lib/nativeAppearance.js` | Evidence-gated effective-fit helper/policy, text/width/height `fitBinding`, partial-fit validator. |
| `packages/core/src/document/index.js` | Invalidate shrink/resize proofs on text and width/height edits; preserve x/y/rotation-only proofs. |
| `packages/core/src/document/index.d.ts` | Add native source-owned optional `TextBodyLayout.fit`; introduce a fit-free authored body-layout type and leave patch type unchanged. |
| `packages/source/src/authoring-format.test.js` | Reader/writer partial-fit and malformed-value tests. |
| `packages/source/src/nativeAppearance.test.js` | Real PPTX projection, malformed refusal, partial/default proof, and byte-identity tests. |
| `packages/core/src/lib/nativeAppearance.test.js` | Input binding, effective-fit, validator, cap, and direct-mutation staleness tests. |
| `packages/core/src/document/nativeAppearanceCommands.test.js` | Command invalidation, no-op, move/rotate preservation, undo/redo, and remote/headless tests. |
| `tests/types/foundation.ts` | Public `TextBodyLayout.fit` declaration coverage; patch remains fit-free. |

No changes planned to renderer, React, PPTX/ODP writers, export measurement, vendored OfficeView, or ODP behavior.

## Red-first test list

### Task 1 — Partial source retention and byte identity

1. `readPptxBodyLayout()` returns `autofit: 'shrink'` with `fit: {}` for `<a:normAutofit/>`.
2. It returns only `fontScale` for fontScale-only XML, only `lnSpcReduction` for reduction-only XML, and both for full XML.
3. Present malformed values (`90000%`, fractional, negative, zero fontScale, >100000, unsafe integer) never enter canonical `fit`.
4. Unknown `normAutofit` attributes/children and unsupported `spAutoFit` attributes/children are represented as invalid for projection.
5. Direct reader/writer checks prove absent attributes are not materialized.
6. Public type accepts partial `fit`; `TextBodyLayoutPatch` still rejects `fit`; `AuthoredObject.bodyLayout` uses a fit-free authored type with a consumer `@ts-expect-error`; authored runtime validation rejects `{ autofit: 'shrink', fit: {} }`.
7. With the R2 strict policy, empty, fontScale-only, and reduction-only canonical fit produce no effective fit and no source proof.
8. The pure core helper’s default-resolved mode returns 100000/0 for empty fit, stored fontScale/0 for fontScale-only, 100000/stored reduction for reduction-only, and both stored values for full fit.
9. Package-level malformed-open and untouched-export byte identity cover no-attribute, fontScale-only, reduction-only, and full-value `normAutofit` boxes; each asserts `dirtyParts: []` and whole-package byte equality.

### Task 2 — Core input, effective fit, and validator

10. Non-autofit object input remains unchanged by text and all geometry fields.
11. Shrink and resize inputs change when run text, width, or height changes.
12. Shrink and resize inputs do not change for x, y, or rotation-only changes.
13. Shrink input contains partial canonical `bodyLayout.fit` plus `effectiveFit` when the policy permits it; absent and explicit-default values remain distinguishable.
14. Empty/partial exact-key shrink fit validates only when the evidence policy permits defaults; strict mode refuses absent attributes. For every malformed/extra fit case, regenerate `proof.input` with `nativeObjectAppearanceInput()` before asserting rejection, and include a valid matching-input control so the fit validator—not only input mismatch—is exercised.
15. `fit` on resize/non-autofit fails; a proof input with `fitBinding` removed fails.
16. Large run text does not inflate the input with raw text; the binding stays fixed-size and the 16 KiB cap remains enforced.
17. Direct text/width/height mutation without a command makes the proof stale through input mismatch.

### Task 3 — Native source projection

18. Real PPTX full-value `normAutofit` and `spAutoFit` boxes receive valid object proofs under R2 strict policy.
19. Real PPTX no-attribute, fontScale-only, and reduction-only boxes receive no object proof under R2 strict policy but open successfully.
20. Malformed/unknown raw autofit values receive no object proof but open successfully.
21. Existing autofit/list test is split: full-value autofit proves under strict policy; list text still refuses.
22. Untouched partial-fit export remains byte-identically for no-attribute, fontScale-only, reduction-only, and full-value boxes; proof-only cleanup remains export-neutral; ODP fixtures remain unchanged.
23. Authored object/command validation rejects source-owned `bodyLayout.fit` even though the public native layout type permits it.

### Task 4 — Command lifecycle

24. `document.setRunText` invalidates both shrink and resize proofs on any actual same-script text change; no-op text preserves proof/revision/history.
25. `presentation.setGeometry` invalidates both on actual width or height changes.
26. x/y/rotation-only geometry changes preserve both proofs and remain admitted.
27. No-op geometry preserves proof, revision, and undo state.
28. Existing font/paragraph/body-layout invalidation remains green for both autofit kinds.
29. Undo/redo restores proof presence/absence for text and size edits.
30. Remote/headless dispatch (`origin: 'remote'`) follows the same invalidation; direct mutation is caught by the binding.
31. Width-only and height-only `presentation.setGeometry` controls on a proved non-autofit native object preserve its proof and validity.

---

## Tasks

### Task 1: Reader, type, and byte identity

**Files:** `packages/source/src/authoring.js`, `packages/source/src/authoring-format.test.js`, `packages/core/src/document/index.d.ts`, `tests/types/foundation.ts`.

- [ ] Add direct reader/writer tests 1–6 and run `npx vitest run packages/source/src/authoring-format.test.js packages/core/src/document/nativeAppearanceCommands.test.js`; verify red for partial-fit expectations and authored-fit rejection.
- [ ] Retain only recognized, valid, present `normAutofit` attributes in `bodyLayout.fit`; leave absent attributes absent.
- [ ] Add optional partial `fit` to `TextBodyLayout`; add a fit-free `AuthoredTextBodyLayout` used by `AuthoredObject`; do not add `fit` to `TextBodyLayoutPatch`.
- [ ] Run focused tests and `npm run test:types`; verify green.
- [ ] Commit `feat(source): retain partial native autofit values`.

### Task 2: Core effective fit, binding, and validator

**Files:** `packages/core/src/lib/nativeAppearance.js`, `packages/core/src/lib/nativeAppearance.test.js`.

- [ ] Add tests 7–17 and run `npx vitest run packages/core/src/lib/nativeAppearance.test.js`; verify red.
- [ ] Add `NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED = false` and a pure effective-fit helper with explicit strict/default modes.
- [ ] Add `fitBinding` for shrink/resize over ordered run text + width + height only.
- [ ] Add exact partial-fit validation; strict mode refuses absent attributes, default mode derives 100000/0, and malformed present values always fail.
- [ ] Run focused tests; verify green and input cap remains intact.
- [ ] Commit `feat(core): bind native autofit proofs to stored fit`.

### Task 3: Source proof projection

**Files:** `packages/source/src/nativeAppearance.js`, `packages/source/src/nativeAppearance.test.js`.

- [ ] Add tests 18–23 and run `npx vitest run packages/source/src/nativeAppearance.test.js`; verify red.
- [ ] Validate raw `normAutofit`/`spAutoFit` shape and values before proof creation.
- [ ] Allow supported autofit through `supportedTextXml`/`projectText`; under the R2 strict policy, prove full-value shrink and resize while refusing absent shrink attributes.
- [ ] Emit proofs with partial canonical fit + core effective input/binding when policy permits.
- [ ] Run focused source tests plus all three partial-fit byte-identity cases and ODP regressions; verify green.
- [ ] Commit `feat(source): prove supported native autofit display`.

### Task 4: Core command invalidation

**Files:** `packages/core/src/document/index.js`, `packages/core/src/document/nativeAppearanceCommands.test.js`.

- [ ] Add tests 24–31 and run `npx vitest run packages/core/src/document/nativeAppearanceCommands.test.js`; verify red.
- [ ] Invalidate shrink/resize proofs on actual text and width/height changes only.
- [ ] Preserve proofs for x/y/rotation-only and no-op commands.
- [ ] Verify undo/redo and remote/headless transaction paths.
- [ ] Run focused tests; verify green.
- [ ] Commit `fix(core): invalidate native autofit proofs on fit edits`.

### Task 5: Full verification and review handoff

- [ ] Run `npm run coverage`, `npm run test:types`, `npm run build`, `npm run test:consumer`, and `npm run check:boundaries`.
- [ ] Run the same 65-package source proof counter; report strict versus default-resolved eligibility without claiming renderer admission before R1.
- [ ] Run `/simplify` on the diff and address cleanups.
- [ ] Request Claude + Agy review at the final head.
- [ ] Do not merge before R1. R2 keeps `NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED = false`.

### Task 6: R3 evidence-gated enablement handoff

- [ ] After Codex’s §8 native evidence passes, set `NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED = true` and change source integration tests 19/22 to expect valid proofs for no-attribute, fontScale-only, and reduction-only boxes.
- [ ] If evidence fails, retain strict mode and disclose the 35/100 projection.
- [ ] Rerun the same-corpus histogram and report strict versus default-resolved results side by side.
