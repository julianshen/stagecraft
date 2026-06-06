# Code Review — fix/critical-architecture-issues

**Date:** 2026-06-06  
**Scope:** PR #1 — `fix/critical-architecture-issues` → `master`  
**Commit:** `fdba4d6`  
**Reviewer:** AI-assisted  
**Status:** needs_changes

---

## Summary

This PR fixes 5 critical architecture bugs: deck state lifting to App (fixes data loss on view switch and export), MCP `reorder_slides` section synchronization, `system` prompt forwarding through the LLM proxy, and a stale closure in `deleteSlide`. All fixes are directionally correct and well-tested (68 tests, 91.09% branch coverage). However, the PR introduces several follow-up issues that should be addressed before merge.

| Severity | Count | Description |
|----------|-------|-------------|
| 🟡 Important | 6 | Real issues with bounded blast radius |
| 🔵 Suggestion | 3 | Style/pattern issues or overstated concerns |
| 💭 Discussion | 2 | Pre-existing issues, not introduced by this diff |

---

## 🟡 Important

### Q1 — Empty-string `system` prompt is silently omitted

`src/server/api.js:34` — `if (system) reqBody.system = system;`  
`src/lib/llmClient.js:33` — `if (options.system) body.system = options.system;`

An empty-string system prompt (`""`) is falsy in JavaScript and will be silently dropped on both client and server. A caller passing `{ system: "" }` to explicitly clear a default system prompt will see it ignored. Use `system !== undefined` or `typeof system === 'string'` for explicit null-vs-empty distinction.

**Fix:** Change both guards to `if (system != null)` or `if (typeof system === 'string')`.

### Q2 — System message prepended without deduplication guard

`src/server/api.js:46` — `reqBody.messages = [{ role: 'system', content: system }, ...(messages || [])];`

If the caller's `messages` array already contains a `{ role: 'system' }` message, this prepends a second one, producing a duplicate system message in the OpenAI request. Anthropic handles this natively (`reqBody.system` is a top-level field), but the OpenAI path should guard against duplicate system roles.

**Fix:** Filter existing system messages before prepending, or document that callers must not include system messages when using the `system` parameter.

### Q3 — `args.order` assumed to be an array without validation

`src/server/api.js:81` — `const order = args.order || [];`

A non-array truthy value (e.g. `"abc"`, `{}`, `123`) bypasses the `|| []` fallback and throws at `.map()` with a TypeError. The MCP API has no input schema validation (`runTool` does not validate against `MCP_MANIFEST.inputSchema`), so this is a reachable crash path.

**Fix:** Add `Array.isArray(order)` validation before the `.map()` call.

### Q4 — `reorder_slides` mutates pool before sections; no rollback

`src/server/api.js:83` — `store.deck.slides = reordered;`  
`src/server/api.js:87` — `for (const sec of (store.deck.sections || [])) { ... sec.slides = ... }`

The pool is replaced before the section-loop begins. If any section's `.sort()` comparator throws (e.g. a custom comparator bug, or a concurrent mutation), the pool has already been updated but the sections are in a partially-mutated state. For an in-memory store this is a low-probability concern, but the ordering of operations should be: validate → build derived structures → commit all mutations atomically.

**Fix:** Build the new `sections` arrays in local variables, then assign them all at once after the loop completes.

### Q5 — `deleteSlide` cursor fallback reads prop instead of functional-update `prev`

`src/components/editor/Editor.jsx:111` — `const prevDeck = deck;`

The fix captures `deck` before the `onDeckChange` call, which is an improvement over the previous stale-closure bug (reading `deck` after `setDeck`). However, `deck` is still a prop that may lag behind the parent's state during batching. The correct pattern is to compute the next cursor inside the functional updater callback where `prev` is guaranteed to be the latest state.

**Fix:** Move cursor computation inside the `onDeckChange(prev => { ... })` updater, or use `useEffect` to react to deck changes and reposition the cursor.

### Q6 — `deleteSlide` has no null guard on `sections`

`src/components/editor/Editor.jsx:115` — `prevDeck.sections.forEach(...)`

The server-side `delete_slide` MCP tool tolerates `sections: null` via `|| []` fallback (`api.js:70`), but the client-side `deleteSlide` will throw `TypeError: Cannot read properties of null` if `sections` is null. This creates a client/server behavior mismatch.

**Fix:** Add `prevDeck.sections || []` guard, matching the server's defensive posture.

---

## 🔵 Suggestions

### Q7 — Unguarded deep-clone on App mount [Weakened]

`src/App.jsx:47` — `JSON.parse(JSON.stringify(SAMPLE_DECK))`

The claim that a circular reference would crash initialization is **overstated** — `SAMPLE_DECK` is a static, well-known object with no circular references. The deep-clone is safe in practice. However, this pattern is brittle: if `SAMPLE_DECK` ever gains a circular reference or a non-serializable value (Date, Map, etc.), the app will crash on mount.

**Fix:** Use `structuredClone()` (modern browsers) or a deep-clone utility. Or better, stop deep-cloning entirely and use immutable update patterns.

### Q8 — `onDuplicateSlide` is still a no-op

`src/components/editor/Editor.jsx:161` — `onDuplicateSlide: () => {}`

This is a pre-existing stub, not introduced by this diff. It's noted here because the PR's PR description claims it fixes "5 critical architecture issues" but leaves this known bug untouched. The callback bag now has 11 wired callbacks and 1 no-op, breaking pattern coherence.

**Fix:** Implement `duplicateSlide` or remove the callback from the bag until it's implemented.

### Q9 — `ExportModal` deck access partially guarded [Weakened]

`src/components/modals/ExportModal.jsx:23` — `await exportToPPTX(deck);`  
`src/components/modals/ExportModal.jsx:40` — `{deck?.title || 'Presentation'}`  
`src/components/modals/ExportModal.jsx:58` — `{deck?.slides?.length || 0}`

The title and slide count use optional chaining, but the `exportToPPTX(deck)` call does not. If `App.jsx` ever fails to pass `deck`, the exporter receives `undefined` and may crash. Given that `App.jsx` always passes `deck` now, this is a low-risk edge case.

**Fix:** Add a guard: `if (!deck) return;` at the start of `handleExport`.

---

## 💭 Discussion (Pre-existing)

- `api.js:38` — Upstream API errors flattened into 200-response text fallback. Pre-existing, not changed by this diff.
- `Editor.jsx:19` — PUT sync catch block swallows all errors. Pre-existing, not changed by this diff.

---

## Coverage

| Metric | Value |
|--------|-------|
| Statements | 100% (380/380) |
| Branches | 91.09% (133/146) |
| Functions | 100% (12/12) |
| Lines | 100% (380/380) |
| Tests | 68 passing |

**Coverage gaps:** `llmClient.js:53` (fallback return for unknown response shapes), `api.js:88` (sort comparator `?? 0` fallback), `api.js:110` (empty URL branch). These are edge-case branches that would require contrived test inputs.

---

## Recommendation

**Approve with minor fixes.** The 5 critical bugs are correctly fixed. Address Q1–Q6 (the 🟡 items) before merge:

1. **Q1 + Q2**: Fix system prompt falsy handling and dedup guard (2 lines)
2. **Q3**: Add `Array.isArray(args.order)` validation (1 line)
3. **Q4**: Reorder `reorder_slides` to build sections locally before assigning (3–4 lines)
4. **Q5**: Move cursor computation inside the updater (small refactor)
5. **Q6**: Add `|| []` guard on sections (1 line)

None of these are blockers — the PR's core fixes are solid and well-tested.