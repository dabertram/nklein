# Modern Cross-Platform DAW — Foundation Release

This fixture is the seed of a **professional, cross-platform digital audio workstation** meant to be a credible
rival to Ableton Live, FL Studio, Bitwig Studio, Logic Pro, Cubase, Studio One, Reason, and Reaper.

**`specification.md` is the authoritative product + engineering specification.** It is large and
domain-knowledge-heavy on purpose — read it fully, fetch external knowledge where the spec points at standards/
SDKs/algorithms (DSP, psychoacoustics, music theory, VST3 SDK, Web Audio/AudioWorklet, WebGPU, MCP, real-time
audio), and decompose the work into a dependency-linked graph of right-sized, independently testable cards.

The repo starts intentionally tiny: a real, deterministic **musical timebase** (PPQ ticks ↔ samples, tempo-map
aware — spec §16.2). Grow it into the layered architecture in spec §17: portable domain core → musical engines →
DSP/device layer → platform adapters → session/control → presentation → MCP/automation. Build real DSP and
golden, deterministic tests — no fake stubs.

Run tests with:

```sh
npm test
```
