Turn the tiny TypeScript DSP prototype into a VST-style audio plugin core for modern psytrance grooves.

Starting point (already in the repo): `renderKick`, `renderBass`, and `peakLevel` in src/plugin.ts produce
deterministic Float32Array buffers from typed voice settings. Grow this into a small but real plugin core.

Domain model (define these as typed interfaces — no `any`):
- `RenderedBuffer { sampleRate: number; samples: Float32Array }` — the universal mono audio unit.
- `KickVoiceSettings` / `BassVoiceSettings` — the synthesis parameters (extend the existing ones).
- `SequenceStep { voice: 'kick' | 'bass'; startTick: number }` and a 4-on-the-floor pattern at a given BPM.
- `ControlSpec { id; label; min; max; default; unit }` — UI metadata for every exposed parameter.
- `EffectSettings` for any effect (e.g. saturation, filter), with a documented safe parameter range.

Expected product capabilities:
- Generate clean kick and bass sounds suitable for modern psytrance, with clear transients and controlled low end.
- Generate a four-beat sequence with a clean, phase-aligned kick/bass pattern.
- Add a simple, intuitive, modern UI-state model for every exposed feature/control.
- Add effects only with guardrails that preserve psytrance groove clarity, transient definition, and low-end phase alignment.
- Include tests that check bounded output, deterministic rendering, phase alignment, clean low-end behavior, sequence timing, UI control metadata, and effect guardrails.
- Do not add dependencies or require an actual DAW/VST host; implement a portable VST-style DSP/plugin core with testable TypeScript APIs.

Audio invariants the acceptance test must assert (deterministic — fixed sample rate + seedless math, no live audio):
- Every rendered buffer is bounded: |sample| <= 1 for all samples (no clipping past full scale).
- Rendering is a pure function of its settings: the same settings always produce a byte-identical buffer.
- The kick's onset (transient) is its highest-energy region; the kick decays toward silence by the end of the buffer.
- In the sequence, kick and bass that share a beat start in phase (the bass does not begin mid-cycle against the kick),
  so the four-beat groove stays phase-aligned and the low end does not cancel.
- An effect with parameters inside its declared safe range never raises the peak level above 1 (the guardrail holds).

Knowledge assumptions to make explicit (track what you do not know rather than guessing):
- psytrance kick/bass design, transient shaping, phase alignment, four-on-the-floor timing at a given BPM, and
  what 'clean low end' means (mono-compatible, phase-coherent, no sub cancellation).