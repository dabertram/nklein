# Psytrance VST Prototype

This fixture starts as a tiny TypeScript DSP prototype. The goal is to grow it into a VST-style audio
plugin core for clean modern psytrance kick and bass grooves — **without adding dependencies and without
requiring a real DAW/VST host**.

**`specification.md` is the authoritative product specification** (entities, audio invariants, and the
knowledge assumptions to make explicit). Read it first.

The seed (`src/plugin.ts`) already renders deterministic `Float32Array` buffers from typed voice settings
(`renderKick`, `renderBass`, `peakLevel`). Every public function must stay a **pure function of its settings**
so rendering is byte-for-byte reproducible — that is what makes the acceptance test deterministic (no live
audio, no randomness, no clock). Grow it into a small but real plugin core: synthesis controls, a
phase-aligned four-beat sequence, UI control metadata, and effects with guardrails.

Build dependency-ordered, independently reviewable cards: the sequence depends on kick + bass rendering;
UI state depends on the exposed controls; effects depend on the dry kick/bass/sequence APIs; tests and the
README depend on the implementation they validate or describe.

Run tests with:

```sh
npm test
```
