# Modern Cross-Platform DAW Foundation Release Specification — Native + Web, Linked Multi-Screen Workspaces, Sequencer, Arranger, VST, MIDI, Instruments, Visualizers, MCP Control

> **Version 5** — Foundation Release product and engineering specification, extended to full modern-DAW feature
> parity. "Foundation Release" means an impressive, usable, *professional* first release — not a disposable or
> intentionally weak MVP. The bar is: a producer should seriously consider this **instead of** Ableton Live,
> FL Studio, Bitwig Studio, Logic Pro, Cubase, Studio One, Reason, or Reaper.
>
> **This is a deliberately enormous, domain-knowledge-heavy specification** used to stress autonomous build
> systems and local LLM agents to their limits. Implementers are expected to fetch and synthesize external
> domain knowledge extensively (DSP, psychoacoustics, music theory, VST3 SDK, Web Audio/AudioWorklet, WebGPU,
> MCP, real-time systems, plugin sandboxing, multi-window coordination) rather than guess. Only state-of-the-art,
> production-quality work is acceptable. No fake stubs, no "lame small result", no hardcoded magic where a real
> algorithm is required.

---

## 0. How To Use This Specification (for the build agent)

- Treat sections 1–21 as the **product contract** and sections 22–31 as the **competitive-parity and
  extended-capability contract**. Both are in scope for the Foundation Release architecture even where a feature
  is explicitly deferred — the architecture must not preclude it.
- **Decompose deeply.** This is not a single task; it is a platform. Break it into a dependency-linked graph of
  right-sized cards across the layers in §17 (domain core → engines → DSP/devices → platform adapters →
  session/control → presentation → automation/MCP). Test/acceptance cards must depend on the implementation they
  verify; documentation cards must depend on the work they document.
- **Record knowledge debt explicitly.** For every domain-heavy card (DSP, synthesis, warping, psychoacoustic
  loudness, VST3 hosting, real-time safety, WebGPU), state what is not yet known and what authoritative source
  must be consulted. Use code search / repo map / architecture knowledge first, then sanctioned external lookup.
- **Golden, deterministic tests are mandatory** for every built-in device and engine path (numeric tolerances,
  phase alignment, bounded output, no NaN/denormal, sample-accurate scheduling). UI/flows that cannot be
  unit-verified must be exercised by a headless command path.
- **Never ship architectural shortcuts** that would block later features (warping, comping, modular devices,
  collaboration, cloud, marketplace, scoring, hardware, video). Every platform difference is a tested adapter +
  a machine-readable capability entry, never silent feature loss.

---

## 1. Product Vision

Build a modern cross-platform digital audio workstation that combines the immediacy of FL Studio-style pattern
creation with a full linear song arranger, an Ableton/Bitwig-style clip-launch performance surface, professional
audio/MIDI editing, native VST3 plugin hosting, built-in instruments/effects, adaptive music visualization,
linked multi-screen workspaces, and a first-class MCP interface so LLMs can operate the entire DAW.

The product must be one coherent platform delivered as native desktop applications for Windows, macOS, and Linux,
plus a serious browser/PWA edition. The web edition must be capable of producing complete songs with built-in
instruments and effects on its own. Multiple browser windows must be able to join one project session and operate
as coordinated arranger, mixer, editor, device, assistant, and visualizer surfaces. Native and web variants must
share the same versioned project schema, command model, built-in device definitions, automation model, and MCP
semantics rather than becoming separate products.

This is not a lazy MVP. In this document, MVP means **Foundation Release**: a first public-quality version that
is already musically useful, beautiful, stable, and exciting, while still being smaller than the eventual full
product. The release must be designed from day one as a credible future rival to Ableton Live, FL Studio, Logic
Pro, Bitwig Studio, Cubase, Studio One, Reason, Reaper, and other serious DAWs.

The Foundation Release should feel fun immediately: open the app, choose an EDM/techno/psytrance template, make a
beat in seconds, build a bassline and lead with serious built-in synths, arrange a full track, automate
parameters visually, load VSTs, export stems, and ask an LLM to build or modify music through a safe, inspectable
control layer.

Primary design goals:

- Fast idea capture.
- Pattern-first **and** timeline-first **and** clip-launch performance workflows in one product.
- Full song arrangement from the Foundation Release, not a later feature.
- VST3-compatible plugin hosting from day one.
- Extensible internal device graph with a modulation system and modular device environment.
- MIDI and audio as first-class citizens, including audio warping and comping.
- Modern, beautiful, low-friction UI.
- Every meaningful feature exposed through MCP.
- Safe LLM control with undo, preview, sandboxing, and user approval.
- A premium Foundation Release experience, not a throwaway prototype.
- Complete EDM, techno, psytrance, trance, house, and bass-music creation workflow from day one, with a clean
  path toward rock/pop/hip-hop/orchestral/film/podcast/live performance.
- Built-in instruments powerful enough to produce release-quality electronic music without external plugins.
- A factory library that teaches the product by example: templates, devices, presets, patterns, demo projects,
  visualizer presets, and mastering chains.
- Native Windows, macOS, and Linux delivery from the architectural baseline.
- A browser/PWA edition that remains musically complete with built-in devices.
- Linked multi-window and multi-display workspaces in both native and browser runtimes.
- One portable project, device, command, and MCP contract across all platforms.
- Explicit capability negotiation and graceful fallback instead of silent feature loss.
- A secure native engine bridge for browser access to native VST3 plugins, professional audio drivers, and
  hardware when those capabilities cannot run directly inside the browser sandbox.

Reference compatibility note: VST3 should be the Foundation Release native plugin target because Steinberg
provides the official SDK and developer resources for VST3 hosts and plugins. The browser runtime must use
portable built-in/WASM devices and, when native plugins are requested, connect to a secure native engine bridge
rather than pretending that operating-system VST binaries can execute directly in a normal web page. MCP should
follow the official model of exposing capabilities through tools, resources, and prompts.

## 2. Foundation Release Scope

The Foundation Release is not a toy, prototype, or reduced demo. It is the first coherent version of a
professional DAW platform. It should support complete song production with a deliberately curated feature set,
polished workflows, and an architecture that can grow without rework. It should not include every advanced
feature found in mature DAWs, but every included feature must feel intentionally designed, reliable, and
musically powerful.

A user should be able to produce a convincing EDM, techno, psytrance, trance, house, or bass-music track using
only the built-in devices, samples, presets, sequencer, arranger, mixer, visualizer, and export tools.

### Foundation Release must include

1. Versioned cross-platform project system.
2. Portable real-time audio and MIDI core.
3. Professional mixer and routing graph.
4. Pattern sequencer (step + parameter locks).
5. Piano roll.
6. Drum grid.
7. Full song arranger (linear timeline).
8. Clip launcher / scene sketchpad (Session-view-class performance surface).
9. Automation lanes and automation clips.
10. Tempo and time-signature map (with tempo detection + warp markers).
11. Native desktop applications for Windows, macOS, and Linux.
12. Installable browser/PWA edition with offline-capable built-in production workflows.
13. Linked multi-window and multi-display workspaces.
14. Native VST3 instrument and effect hosting.
15. Secure native engine bridge for browser-controlled VST3, professional audio I/O, and hardware MIDI.
16. Portable built-in instrument and effect runtime compiled for native and WebAssembly targets.
17. Pro-grade built-in electronic instruments inspired by modern wavetable, spectral, sample, drum, and
    modulation workflows.
18. Complete EDM/techno/psytrance-focused factory library.
19. MIDI input, output, recording, editing, mapping, synchronization, and routing (with MPE-ready model).
20. Audio import/export.
21. MIDI import/export.
22. Stem export and bounce/freeze workflows.
23. Adaptive music visualizer capable of running in a dedicated linked window or display.
24. MCP server/runtime exposing complete DAW control.
25. Browser-to-MCP gateway for external LLM clients, with the same tool schemas as the native application.
26. Plugin parameter discovery and control through MCP.
27. Stable command/event protocol shared by UI, scripting, MCP, and multi-window clients.
28. Undo/redo for all user, window, script, and MCP operations.
29. Crash-safe project autosave, recovery, and migration.
30. Capability reporting so every client knows which audio, MIDI, plugin, storage, GPU, and display features are
    active.
31. Cross-platform CI, project compatibility tests, and deterministic built-in-device render tests.
32. Audio warping/time-stretch on audio clips (at least one transparent and one transient-preserving algorithm).
33. A device modulation system (assignable modulators on any built-in/automatable parameter).
34. Instrument/effect/drum **device racks** (nested device groups with macro controls).
35. Comprehensive built-in metering (peak, RMS, LUFS-momentary/short/integrated, true-peak, correlation,
    goniometer, spectrum).
36. A groove pool (extract/apply timing+velocity grooves) and humanize/quantize-strength engine.

### Foundation Release should not initially include (architecture-compatible, not blockers)

- Full notation/score editor (architecture-ready; basic event list + later score).
- Surround/immersive audio.
- Advanced pitch correction (basic MIDI-style audio pitch edit ok; studio-grade tuning later).
- Advanced spectral editing/resynthesis.
- Video scoring (a video reference track may land early; full scoring later).
- Cloud collaboration / multi-user real-time editing (protocol must be forward-compatible).
- Marketplace.
- Full phone-sized production application (a mobile companion/controller may follow, using the same session +
  command protocol).
- Source-separation/stem-splitting of arbitrary audio (later).

### 2.1 Foundation Release Quality Bar

The first release must meet a higher bar than a typical MVP:

- Usable for complete tracks, not only sketches.
- A polished full song arranger, not only loops, **and** a usable clip-launch performance surface.
- A pattern sequencer that feels fast enough to compete with established electronic-music workflows.
- Built-in synths and drum tools strong enough that users do not immediately need paid third-party plugins.
- A preset and template library that demonstrates professional results.
- Clean project compatibility, stable IDs, deterministic save/load, and migration-ready schema.
- No architectural shortcuts that block later features (warping comping/clip-comp, modular devices,
  collaboration, cloud sync, marketplace content, hardware integration, scoring).
- The same project package opens on all supported native systems and in the web edition, subject only to clearly
  reported external-plugin capability differences.
- The web edition is not a second implementation with a divergent project model or reduced command API.
- Multi-window operation survives window joins, reloads, closures, focus changes, and engine-authority handoffs
  without corrupting the project or duplicating playback.
- Every platform-dependent capability is behind a tested adapter and represented in a machine-readable capability
  manifest.

### 2.2 Initial Genre Focus

Strongest initial identity for electronic music: EDM, techno, psytrance, progressive trance, house, drum and
bass, bass music, ambient electronic, cinematic electronic. Later releases expand toward rock, pop, hip-hop,
orchestral, jazz, film scoring, podcasting, live performance, and general-purpose recording. The architecture
must therefore support both loop-based production and traditional linear recording from day one.

## 3. Core Concepts

### 3.1 Project

A project contains: global metadata; tempo map; time-signature map; arrangement timeline; clip-launch scenes;
patterns; clips; mixer channels; device chains; modulation graph; automation data; MIDI routings; audio assets;
warp/transient analysis; groove pool; visualizer presets; workspace layouts; MCP automation history.

Project file format:

- Human-readable manifest: `project.json` or `project.dawproj`.
- Binary/audio assets in `/Audio`; render cache in `/Cache`; plugin state snapshots in `/Plugins`; visualizer
  presets in `/Visualizers`; autosaves in `/Autosave`; platform capability requirements in `/Capabilities`;
  optional frozen-audio fallbacks in `/Freezes` so projects remain audible when an external plugin is unavailable;
  analysis caches (warp markers, transient maps, loudness) in `/Analysis`.

Cross-platform project rules:

- Paths inside the package must be relative and normalized.
- External files are stable asset IDs plus optional source-location hints; an absolute path is never the only
  reference.
- Built-in devices store a versioned device type, parameter schema version, and migration version.
- External plugins store plugin UID, vendor, version, bus layout, state blob, parameter snapshot, and a
  human-readable fallback description.
- Missing plugins load as non-destructive placeholders that preserve routing, automation, parameter IDs, and
  saved state.
- The browser edition stores active projects in Origin Private File System (OPFS) or an equivalent adapter and
  imports/exports the same portable package used by native editions.
- Project saves use atomic manifest replacement and content-addressed assets where practical.
- Save/load is deterministic across Windows, macOS, Linux, and web.

Use a zipped project package for portability, plus an unpacked folder mode for development.

### 3.2 Track

Track types: instrument, audio, drum, MIDI, automation, bus, return/send, master, visualizer control, **folder/
group**, **take/comp lane parent**. Every track has: name, color, icon, input routing, output routing, device
chain, mixer strip, clips on the arranger, clip slots on the launcher, automation lanes, modulation targets, and
an MCP-readable ID.

### 3.3 Clip

Clip types: MIDI, audio, pattern, automation, scene, visualizer, **take/comp**. Every clip has: start time,
duration, loop region, clip gain/velocity transform, warp/stretch settings for audio, transient/warp markers,
follow-action settings (launcher), muted/active state, color, label, and an optional linked pattern reference.

### 3.4 Pattern

A pattern is a reusable musical container independent of the arranger: drum, MIDI/instrument, automation, or
hybrid. Patterns can be placed multiple times (linked or made unique). Pattern-blocks (FL-style) and Session
clips (Ableton-style) are two presentations of the same underlying clip model.

---

## 4. Sequencer Requirements

The sequencer must support FL Studio-style beat creation, Elektron-style parameter locks, classic step
sequencing, and modern clip-based workflows.

### 4.1 Step Sequencer

4/8/16/32/64/custom step lengths; per-lane step resolution; per-pattern length; polymeter (per-lane length); step
velocity; step probability; step repeat/ratchet; step offset/nudge; microtiming; swing per pattern and per lane;
accent steps; flam steps; reverse trigger for samples; step mute; **per-step parameter locks**; MIDI note
assignment per lane; choke groups; humanize; randomize; **Euclidean rhythm generator**; fill generator; ghost
step preview; conditional trigger (Elektron-style: 1:2, 2:2, fill, neighbor, probability) ; per-lane parameter
slides.

### 4.2 Drum Sequencer

Lanes for kick, snare, clap, closed hat, open hat, tom, percussion, crash/ride, and user sample lanes. Each lane
supports: sample source / built-in drum-synth source / external VST source; pitch; decay; pan; gain; filter; send
levels; output mixer routing; per-lane choke; velocity layers; round-robin.

### 4.3 Pattern Browser

Pattern list; folders; tags (drums, bass, lead, intro, drop, fill, transition); duplicate; make unique; merge
patterns; split by channel; convert to MIDI clip; convert to arranger clips; drag to launcher scene.

### 4.4 Piano Roll (must rival FL Studio's)

Note draw/move/resize/duplicate; velocity editor; per-note automation/MPE-ready fields; quantize (grid + groove +
strength); humanize; scale highlighting + scale-snap; chord helper; ghost notes from other tracks; note preview;
strum tool; arpeggiate tool; legato tool; slice tool; glue tool; flam/roll tool; MIDI expression lanes (velocity,
pan, mod, pitch, slide, pressure, per-note CC); fold to used notes; drum names for drum tracks; note properties
(release velocity, channel, fine pitch); selection-based transforms (transpose, invert, retrograde, randomize
within scale, stretch/compress time); chord/scale-aware editing; LFO-tool to draw modulation; multi-clip editing.

### 4.5 Sequencer Playback Modes

Pattern loop; song mode; **scene/clip-launch mode** with quantized launch + follow actions; live record into
arrangement; overdub; replace recording; loop recording with take stacking; count-in; metronome; pre-roll;
**MIDI capture** (retroactively capture the last played notes even when not armed).

---

## 5. Full Song Arranger Requirements

A first-class song-building environment, not just a clip dump.

### 5.1 Timeline

Bars/beats ruler; time ruler; tempo ruler; time-signature ruler; markers; sections; locators; loop brace; punch
in/out; snap grid (adaptive + triplet/dotted + groove); adaptive zoom; horizontal+vertical overview/minimap;
**arranger track / section track** (Studio One/Cubase-style move-and-rearrange of whole song blocks).

### 5.2 Arrangement Sections

Named sections (intro, verse, pre-chorus, chorus, bridge, drop, breakdown, build-up, outro, custom) with:
drag-to-rearrange song blocks; duplicate; delete with ripple option; color coding; section-level notes;
section-level energy/mood metadata for visualizers and AI.

### 5.3 Playlist / Clip Arrangement

Place pattern/MIDI/audio/automation clips on tracks; overlap clips; crossfade audio clips; slip-edit audio inside
clips; resize; loop; consolidate; bounce selection; freeze track; flatten frozen track; group clips; lock; mute;
color; **clip comping lanes** (record multiple takes into lanes, comp the best parts onto a master take with
non-destructive edit boundaries and crossfades).

### 5.4 Arrangement Editing

Cut/copy/paste/duplicate/delete/split/join/consolidate; ripple edit; insert silence; delete time; duplicate time;
move section; render selected region; export selected region; time-selection-based processing.

### 5.5 Song Structure Assistant

A deterministic, rule-based assistant (exposed through MCP — not generative AI by default): create 8-bar loop;
expand loop into 2-minute arrangement; add intro/breakdown/build-up/ending; vary drums every 4/8/16 bars; add
automation ramp into drop; thin out verse; add transition effects. An LLM calls the same public tools a human
would use.

---

## 6. Automation & Modulation Requirements

### 6.1 Automatable Targets

Mixer volume; pan; send amount; mute/solo; device parameters; VST parameters; MIDI CC; tempo; time-signature
changes; visualizer parameters; clip gain/pitch/filter; modulation-source amounts; macro controls.

### 6.2 Automation Lanes

Points; curves; steps; holds; bezier handles; freehand draw; shape tools (ramp, sine, square, triangle, random,
exponential, S-curve); copy/paste/scale/invert/smooth/thin; per-clip automation **and** track automation; record
automation in latch/touch/write/trim modes.

### 6.3 Pattern Automation (Parameter Locks)

Per-step device/VST/MIDI-CC parameter values and per-step visualizer trigger metadata.

### 6.4 Modulation System (Bitwig/Ableton-class — required, §2 item 33)

A first-class modulation layer **separate from** automation:

- Assignable **modulators** (LFO, multi-stage envelope, step sequencer, random/sample-and-hold, macro, MIDI
  source, audio-follower/envelope-follower, note-stack, voice-stack) that can be dropped onto any automatable
  built-in parameter (and VST parameters within safety limits).
- Per-assignment depth, polarity, and curve; multiple modulators may sum on one target.
- Modulation is sample-accurate where the device/backend allows and is **MCP-readable as a modulation graph**.
- Macro controls: 8+ assignable macros per device/rack mapping to many targets with per-target range.

---

## 7. Audio Engine Requirements

### 7.1 Engine

Real-time low-latency engine; 32-bit float internal minimum (optional 64-bit mix bus later); configurable sample
rates 44.1/48/88.2/96/192 kHz where the backend supports them; buffer sizes 32–2048 on native (web reports/adapts
to browser block behavior); multi-core graph processing on native; plugin delay compensation (PDC); deterministic
offline rendering; real-time-safe parameter changes; sample-accurate automation/modulation where supported; panic
button; **no locks, file I/O, memory allocation, logging, UI calls, or network on the real-time path**; denormal
protection and bounded CPU; audio-graph changes compiled off the audio thread and swapped atomically at safe
boundaries.

Portable runtime: built-in DSP authored in a portable core compilable to native and WebAssembly; native editions
use ASIO/WASAPI, CoreAudio, ALSA/JACK/PipeWire; standalone web runs custom DSP in AudioWorklet (never the UI
thread); web detects real sample rate, latency, input availability, channel capabilities; unsupported project
sample rates use explicit resampling or a visible backend limitation; built-in presets/automation produce
equivalent musical behavior across native/WASM, validated by golden-render tests with defined numeric tolerances.

### 7.2 Routing Graph

Directed audio/MIDI graph: tracks are nodes; devices are subnodes; sends are edges; sidechain inputs are named
ports; visualizer analysis taps are read-only taps; modulation routes are a parallel control graph. Support
arbitrary bus nesting, parallel chains, and **a flexible routing matrix** (Reaper-class: any track/bus output to
any input, with feedback detection).

### 7.3 Mixer

Per channel: volume fader; pan (stereo balance + true dual-pan/mono-pan); mute; solo (with solo-safe); arm
record; input monitoring (auto/in/off); phase invert; stereo/mono switch; metering (peak + RMS/LUFS); insert
device slots; pre/post sends; sidechain source selection; track freeze; track bounce; group/VCA-style control;
gain staging trim. Master with metering + master FX + loudness target.

### 7.4 Platform Audio Backends

Native: Windows ASIO preferred + WASAPI shared/exclusive fallback; macOS CoreAudio; Linux PipeWire/JACK preferred
+ ALSA fallback; device hot-plug; aggregate/multi-device limitations reported; channel naming; exclusive-mode
warnings + recovery. Standalone web: Web Audio + AudioWorklet + MediaDevices (permissioned input) +
OfflineAudioContext/portable offline renderer; explicit user-activation flow; capability-based fallbacks. Bridge:
native engine is the audio authority; VST3/drivers/external MIDI/offline render execute natively; browsers are
synchronized UI clients receiving transport/meters/analysis/parameter state; never stream per-audio-block plugin
processing over ordinary WebSocket.

### 7.5 Single Audio Authority

Exactly one audio authority per session: native engine (native mode); one elected engine-host window (standalone
web); the native bridge (bridge mode). Secondary windows never instantiate independent playback graphs; they send
commands and render synchronized UI. The session coordinator elects/identifies the authority, publishes an
authority lease + heartbeat, prevents duplicate transport, persists enough graph state to rebuild after a browser
engine-host window closes, gracefully stops/fades before a non-seamless handoff, restores
transport/graph/automation/monitoring after recovery, and shows a clear reconnecting status.

---

## 8. MIDI Requirements

### 8.1 MIDI I/O

Input/output devices; virtual MIDI ports; MIDI clock in/out; MIDI Time Code; Ableton-Link-style tempo sync
(later/optional); MIDI learn; mapping profiles; recording; overdub; chase on playback.

### 8.2 MIDI Editing

Notes; velocity; CC lanes; program change; pitch bend; aftertouch; channel pressure; **full MPE** (per-note
pitch/slide/pressure) data model and editing, not just a future stub.

### 8.3 MIDI Routing

Track input selection; channel filtering; note-range filtering; velocity-range filtering; MIDI transform devices;
route to external hardware; route to VST instruments; route MIDI from plugins that emit MIDI; MIDI effect chain
order before the instrument.

### 8.4 Web MIDI and Hardware Access

Use Web MIDI when supported/permissioned; never assume availability (runtime-detect); request SysEx only for an
explicit user-approved workflow; per-device permission/trust; fall back to computer keyboard, virtual pads,
imported MIDI, and the native bridge; in bridge mode enumerate native MIDI through the bridge with stable device
IDs + the same routing model; timestamp in/out MIDI against the audio-authority clock; deduplicate events
observed by more than one client; preserve mappings in the project while storing machine-specific bindings
separately.

---

## 9. VST / Plugin Support

### 9.1 Foundation Release Plugin Formats by Runtime

Native desktop: VST3 host on Windows/macOS/Linux (matching native architecture or an out-of-process compatibility
host); Audio Unit (macOS), CLAP, LV2 are later expansion targets; VST2 only if legally/technically acceptable.
Standalone browser: built-in instruments/effects compiled to WebAssembly; portable third-party devices via a
future signed web-device SDK; a normal page must not claim to load OS VST3 binaries; projects with unavailable
native plugins open with placeholders + frozen fallbacks + intact automation/state. Browser + native engine
bridge: browser controls VST3 running in the native engine; parameters/presets/meters/routing/automation/generic
editors exposed to linked windows; native engine owns plugin audio + crash isolation. Later: AU, CLAP, LV2, signed
web-device packages.

### 9.2 VST Host Features

Plugin scan; database; blacklist after crash; **sandbox process** recommended; instrument/effect/MIDI-effect
plugins; presets; state save/restore; latency reporting (+ PDC); parameter discovery; UI embedding where possible;
generic parameter UI fallback; sidechain routing; multi-output instruments; parameter automation + modulation.

### 9.3 VST Control Overlay for MCP

Expose every discoverable plugin parameter through a normalized control layer: discover plugin ID/vendor/version/
parameter list/normalized ranges/text labels/units/stepped flags; map to stable MCP IDs; generate a generic
control panel; allow semantic relabeling; allow LLM read/write within safety limits. For custom GUIs that hide
controls, combine native parameter API + generic surface + optional CV/manual UI mapping later + user macro
mappings + safe automation recording of changed parameters.

### 9.4 Native Engine Bridge for Web Clients

A secure local bridge protocol (defined now, not later): project-session discovery with explicit user pairing;
loopback-only by default; per-session auth tokens; origin allowlisting; encrypted transport where supported +
mandatory auth even on localhost; version/capability negotiation; native audio device enumeration/config; native
MIDI enumeration/routing; VST3 scan/load/unload/state/parameter/preset/bus/latency ops; plugin crash isolation +
restart reporting; meter/transport/analysis/waveform/progress streams at bounded rates; command acks with project
revision numbers; reconnection without duplicate execution; user-visible bridge status + kill switch. The bridge
uses the same command schemas as local UI and MCP — a transport adapter, not a second implementation.

### 9.5 Cross-Platform Plugin Portability

Match external plugins primarily by stable UID + vendor (not filename); validate compatible bus layouts before
restoring live processing; preserve automation even when missing; offer substitution with a user-selected
compatible plugin while keeping original state; store a freeze/render fallback; mark platform-specific plugins +
architectures in the capability report; never discard an unknown plugin state blob during save; permit full
restore on return to the original system.

---

## 10. Built-In Instruments

Every built-in instrument must expose all parameters to automation, **modulation**, macro controls, MIDI learn,
preset morphing, and MCP. They must feel like real creative tools — optimized for EDM/techno/psytrance/trance/
house/bass, flexible enough for future genres.

### 10.1 Flagship Wavetable / Spectral Synth — "Nova"

Serum/Vital-class power, original implementation. 3 main oscillators + 1 sub; wavetable playback (position, bend,
warp, formant, sync, phase, random phase); spectral modes (smear, harmonic stretch, harmonic tilt, comb,
vowel-like, phase distortion); user wavetable import later, curated factory tables now; dual multimode filters
(serial/parallel/split/per-osc routing); filter types LP/HP/BP/notch/comb/phaser/formant/drive/ladder/SVF/acid;
4 envelopes; 4 LFOs (free/tempo-sync/one-shot/envelope/step/curve); drag-and-drop modulation matrix; per-voice
unison/detune/stereo-spread/phase-random/voice-stacking; MPE-ready data model; built-in FX rack (distortion,
chorus, phaser, flanger, delay, reverb, EQ, compressor, multiband dynamics, dimension/spread, limiter); 8-macro
page; A/B preset morphing; oscillator/spectrum display; MCP-readable modulation graph. Preset categories:
psytrance leads, acid lines, supersaws, plucks, reeses, neuro basses, FM-metallic basses, techno stabs, rave
hoovers, pads, risers, noise sweeps, percussive synth hits.

### 10.2 Semi-Modular Bass Synth — "SubForge"

Mono+legato; 2 analog-style oscillators; sub osc; noise osc; FM amount; phase reset for consistent kick/bass
relationships; glide + pitch envelope; dual drive stages; acid filter + clean SVF; bass mono-maker; built-in
sidechain-ducking input; oscilloscope + phase-correlation display; presets for offbeat bass, rolling psy bass,
techno rumble bass, acid bass, Reese bass, sub drops, distorted basslines.

### 10.3 Drum Synth & Drum Machine — "PulseLab"

Kick/snare/clap/hat/tom/percussion synths; noise+transient generator; layered sample slots; per-pad effects;
per-pad mixer routing; choke groups; round-robin + velocity layers; pattern-aware accent/flam. Kick params: pitch,
pitch-env amount/decay, body decay, click level/tone, punch, sub level, harmonic drive, transient shape, output
gain. EDM/psy kick design: dedicated pitch-envelope editor, phase-start, click/body split processing, key
tracking, render-to-audio, kick/bass phase checker.

### 10.4 Advanced Sampler — "Atlas Sampler"

One-shot/loop/slice/granular-lite/multisample; drag/drop from browser/arranger/OS; start/end markers; loop
crossfade; reverse; pitch+formant; ADSR; filter; per-sample gain/pan/pitch/envelope; slice-to-pads; auto transient
detection; choke groups; velocity layers; root-note detect/manual; render sample to clip. Granular + multisample
mapping editor; round-robin; key/velocity zones.

### 10.5 Groove & Percussion Instrument — "TribeGrid"

16-pad percussion grid; built-in synthetic percussion engines; sample layering; Euclidean per lane; probability/
ratchets/microtiming/polymeter; per-lane randomization with lockable parameters; humanize templates; MIDI
drag-out to arranger.

### 10.6 Chord, Arp, and Generative MIDI Devices

Chord generator; scale quantizer; arpeggiator; step arpeggiator; Euclidean note generator; bassline generator;
psytrance rolling-bass generator; techno rumble helper; strum/humanizer; MIDI delay; velocity shaper; note
probability + conditional trigger device; **note FX rack** (chainable, before the instrument).

### 10.7 Visualizer Instrument/Device

A track/device that receives audio analysis and renders visuals (see §13).

### 10.8 Factory Instrument Library (curated, not empty)

Minimum content: 300 Nova presets; 120 SubForge; 60 PulseLab kits; 80 Atlas instruments; 80 TribeGrid presets;
100 MIDI/generative presets; 25 genre templates; 20 demo projects (full arrangements); 50 visualizer presets.
Tagged by genre, mood, energy, key behavior, timbre, device type, CPU intensity.

---

## 11. Built-In Effects

EQ (parametric + dynamic bands + linear-phase option); compressor (+ optical/FET/bus characters); limiter
(true-peak); gate/expander; saturation/drive (multiple algorithms + oversampling); delay (digital/analog/ping-pong/
tape); reverb (room/hall/plate/shimmer + convolution-ready); chorus; phaser; flanger; filter (modulatable);
bitcrusher; stereo widener (phase-safe); transient shaper; utility/gain (mono/width/phase/DC); **multiband
dynamics**; **sidechain compressor with visible ducking**; **EQ with spectrum + collision/match later**;
metering utility. Every effect exposes all parameters to UI, automation, modulation, MIDI learn, and MCP, with
correct units and oversampling where nonlinear.

---

## 12. Import and Export

### 12.1 Import

Audio: WAV, AIFF, FLAC, MP3, OGG later. MIDI: SMF, tempo-map import, multi-track, drum-mapping options. Project
later: Ableton Link metadata where relevant; DAWproject interchange format if selected as an interoperability
target (recommended). Sample/loop: tempo+key tagging, auto-warp on import.

### 12.2 Export

Audio: WAV/FLAC/MP3/AIFF. Modes: full song; time selection; master mix; stems by track; stems by mixer bus; MIDI
file; loop export; pattern export; preset export; **DAWproject export** (later/optional); visualizer video later.
Render options: sample rate; bit depth; dither; normalize; **LUFS-target normalization**; include/exclude master
effects; tail length; real-time render for external hardware; offline render for internal projects; per-stem +
master in one pass.

### 12.3 Cross-Platform Project Storage & Browser Persistence

Native: portable package or unpacked dev folder; user-selected sample-library roots + relinking; atomic saves +
rolling autosaves; "Collect all and save" to embed external assets. Web: OPFS/equivalent; request persistent
storage + show granted/denied; display quota/project size/cached factory content/cleanup; export/import the same
portable package without server conversion; chunk+stream large audio (never load a whole project into JS memory);
autosave snapshots + recovery browser; operate offline after shell + selected factory content cached.
Cross-platform export: same render-settings model everywhere; bridge renders show which engine rendered;
missing-plugin placeholders block an unqualified final render unless the user chooses frozen fallbacks or
explicitly accepts the omission.

---

## 13. Adaptive Music Visualizer (Winamp-energy, modern)

### 13.1 Analysis Engine

Inputs: master audio; per-track taps; beat grid; tempo; section markers; MIDI note density; chord/root when
available; loudness; spectral centroid; bass/mid/treble energy; transient density; dynamic range. Derived mood:
energy, brightness, aggression, calmness, density, groove intensity, tension/release.

### 13.2 Visual Presets

Neon tunnel; liquid waveform; particle nebula; kaleidoscope bloom; oscilloscope city; bass pulse rings; spectral
mountains; retro plasma; mood aurora; minimal waveform grid.

### 13.3 Visualizer Arrangement Integration

Place visualizer clips on visualizer tracks; change presets by section; automate visualizer parameters; auto-
follow song mood; lock to BPM; trigger visual events from MIDI; export screenshots now / video later; detach into
a dedicated linked window; fullscreen on a chosen display when permitted; receive bounded-rate analysis frames
from the single audio authority (no duplicate playback graph); prefer WebGPU/native GPU with WebGL2 + reduced-
complexity fallbacks; dynamically scalable frame rate/quality so graphics load never causes audio dropouts;
photosensitivity-safe mode + intensity limits.

---

## 13A. Factory Content, Templates, and Genre Workflows

Required templates: EDM festival; peak-time techno; psytrance full-on; progressive psytrance; melodic techno;
acid techno; house groove; drum-and-bass roller; bass-music drop; ambient electronic; blank recording session;
blank MIDI composition session. Each includes track groups, mixer routing, return effects, sidechain routing,
master bus chain, sequencer patterns, arrangement markers, automation examples, a visualizer scene, and
MCP-readable intent notes. Required factory packs: clean/hard electronic drums; psytrance kicks+bass examples;
percussion loops+one-shots; risers/impacts/downlifters/uplifters; synth stabs+rave hits; bass one-shots; noise/
field textures; royalty-safe starter vocal chops. Genre assistants (implemented through normal product features +
MCP tools, never hardcoded magic): build a 16-bar techno loop; create a psytrance kick/bass pattern; turn a loop
into a full arrangement; add breakdown/riser/drop automation; create sidechain routing; generate drum fills
before section changes; create call-and-response synth variations; suggest mix-cleanup steps.

---

## 14. Modern UI Design

### 14.1 Main Layout

Top transport bar; left browser; center workspace; bottom editor panel; right inspector; mixer panel; device-chain
panel; MCP/Assistant panel.

### 14.2 Workspace Tabs

Start; Sequencer; Arranger; Clip Launcher; Piano Roll; Mixer; Visualizer; Plugin Manager; Export.

### 14.3 UX Principles

Dark modern UI + optional light mode; fast keyboard workflow; drag-and-drop everywhere; inline editing; smooth
zooming; clear routing visualization; non-destructive editing; every action undoable; context-aware inspector;
command palette; search everything; AI/MCP activity visible and reversible.

### 14.4 The Fun Foundation Release Flow

Create project → pick genre/mood or blank → step-sequence drums → add bass synth pattern → add chords in piano
roll → drag patterns into arranger → duplicate sections → add automation into drop → load VST effect → open the
mixer in a second linked window → open the visualizer fullscreen on another display → continue editing from the
arranger while every window stays synchronized → ask the LLM "make the second chorus bigger" → review proposed
changes in the assistant window → apply and see all linked views update → export master and stems.

### 14.5 Detachable Workspace System

Every major workspace embeddable in the shell or opened as a linked window (arranger, pattern sequencer, piano
roll, drum editor, mixer, device/instrument editor, plugin generic editor, browser/library, automation editor,
visualizer, clip launcher, MCP/assistant activity panel, export/render monitor). A detached window is a view
client on the same session/command authority/undo history/transport/audio authority — not a second project copy.
View-local state (zoom, scroll, panels, inspector tab) may be local; project/transport/device/routing/automation
state is authoritative and shared.

---

## 14A. Cross-Platform Runtime and Linked Multi-Screen Web Application

*(This entire section is preserved from the product contract; it is load-bearing for the architecture.)*

### 14A.1 Product Editions

Four runtime profiles on one product contract: **Native Studio** (full Win/macOS/Linux DAW); **Web Studio
Standalone** (installable PWA with full sequencer/arranger/mixer/automation/built-ins/visualizer/import-export/
local persistence/linked windows); **Web Studio + Native Engine** (browser UI, native audio/MIDI/VST3/render/
hardware); **Headless/Render Engine** (command-driven engine for tests/batch render/bridge/server). Editions may
differ in backends but not in musical data semantics or MCP tool meaning.

### 14A.2 Platform Targets

Native: Windows 64-bit; macOS Apple Silicon + Intel per release policy; Linux 64-bit on maintained desktops with
PipeWire/JACK validation; architecture boundaries permitting Windows/Linux ARM64 later without project-format
changes. Web: current evergreen desktop browsers via feature detection; a Tier A reference config for richest
low-latency/MIDI/GPU/PWA/multi-display behavior; Tier B for browsers that run the core DAW but need manual window
placement / reduced GPU / the bridge for MIDI/hardware; no browser-name branching when a capability probe works.

### 14A.3 Shared-Core Rule

No "native app" + "web rewrite". Canonical/shared: project schema + migration; stable IDs; commands/events/
validation/undo transactions; sequencer/arranger/automation/routing models; built-in device parameter schemas;
preset format; MCP resources + tool schemas; capability schema; asset identifiers + package layout; test fixtures
+ golden projects. Platform adapters may implement audio/MIDI I/O, plugin loading, filesystem, window placement,
GPU, credential storage, process management — never redefine product behavior.

### 14A.4 Recommended Runtime Boundaries

Portable real-time DSP/graph core (native + WASM); versioned command/domain core independent of DOM/native toolkit;
type-safe generated bindings for TS + native UI; shared UI design system; native engine process separate from UI
where practical; plugin-host processes separate from the engine for crash containment; browser AudioWorklet for
standalone web DSP; SharedWorker/equivalent session coordinator for same-origin windows when available;
BroadcastChannel/MessagePort fallback; Service Worker for PWA shell caching + version upgrades (not real-time
audio); WebGPU/native GPU for visualizers/waveforms/scalable canvases with fallbacks. The VST3 host + portable
DSP core should have stable interfaces so UI/transport choices evolve independently.

### 14A.5 Multi-Window Session Model

Each open project creates a `Session` with: `session_id`, `project_id`, `project_revision`,
`command_authority_id`, `audio_authority_id`, `asset_authority_id`, `mcp_authority_id`, `client[]`, `window[]`,
`capability_manifest`, `transport_snapshot`, `authority_leases`. Each window is a client with stable `client_id`
(connection lifetime), stable `window_id` (persisted with layouts), role (arranger/mixer/piano-roll/device-editor/
visualizer/assistant/custom), subscribed state slices, view-local state, capability report, focus/visibility,
heartbeat, last acknowledged revision. **All edit commands follow one path:** window UI / MIDI / script / MCP →
command envelope → command authority → validate preconditions+permissions → apply one atomic transaction → append
events + undo record → publish new revision → update every subscribed window. No window directly mutates
authoritative project objects.

### 14A.6 Browser Window Coordination

Preferred same-device coordination: one session coordinator in a SharedWorker when available; a dedicated
MessagePort per window; BroadcastChannel as discovery+fallback; structured command/event messages with schema
versioning; optional SharedArrayBuffer ring buffers only after successful cross-origin-isolation probing; ordinary
message passing otherwise. **Window join:** user opens a window/layout → parent creates a one-time join credential
+ target role → child opens from an explicit user gesture (popup rules) → credential passed via same-origin
channel/URL fragment (never a reusable query token) → child validates app version + project/session identity →
coordinator sends snapshot + current revision → child acks + receives ordered patches → credential expires.
**Reload/reconnect:** rejoin without a second project; unacked commands keyed by idempotency key; reconnecting
client requests events since last revision or a fresh snapshot; duplicate commands acked but not re-applied; stale
client rebases/refreshes before committing with failed revision preconditions.

### 14A.7 Multi-Display Placement

Use the Window Management API when available/permitted; always provide manual fallbacks. Detect multiple displays
without depending on them; request permission only after a user action that explains the benefit; workspace
presets ("Laptop + monitor", "Dual monitor", "Triple monitor studio", "Performance + visualizer"); assign roles
to displays; save logical layouts by display traits + relative placement (not raw pixels); reflow safely on
display removal/resolution/DPI change; never open hidden/unexpected windows; "Gather all windows" + "Reset
workspace" recovery; manual drag-and-place when programmatic placement is unavailable. Example three-display:
Display 1 arranger+browser+piano-roll; Display 2 mixer+device chains; Display 3 fullscreen visualizer/performance.

### 14A.8 Shared vs Local UI State

Shared authoritative: project edits; transport+loop; recording; mixer/device/plugin values; automation+modulation;
routing; markers+arrangement selection when shared; global undo/redo; render/export jobs; MCP activity+approvals.
Window-local: zoom/scroll; panel sizes; inspector tab; local cursor/hover; optional local selection; visualizer
camera when unlinked; temporary search text. Users create **link groups** for view state (linked timeline zoom/
scroll, track visibility, selection, device focus, visualizer camera/preset preview) to prevent windows fighting
while enabling synchronized editing.

### 14A.9 Transport, Meter, and Visual Synchronization

Audio-authority clock is canonical; transport snapshots include sample position, musical position, tempo-map
revision, playback state, loop state, engine timestamp, estimated output latency; clients extrapolate visual
playhead between snapshots + correct smoothly; never use independent `Date.now()` as the musical authority;
transport commands carry command IDs + target revisions; meters/spectrum rate-limited + subscription-filtered by
visible tracks; typical 30–60 fps meter delivery; hidden windows reduced/none; full audio streams are not sent to
every window (compact meter/analysis frames preferred); the visualizer receives beat/section events, spectral
bands, loudness, transient features, optional waveform blocks; UI sync never blocks the audio thread.

### 14A.10 Multi-Window Editing and Conflict Handling

Every command has `command_id`, `client_id`, `base_revision`, timestamp metadata, permission scope, optional
transaction group; serialized by the command authority; continuous gestures use begin/update/commit so fader
moves/drags do not flood undo; a client may acquire a short-lived gesture lease on an object (others see busy/
conflict, not silent fighting); structural edits use revision preconditions; non-conflicting commands may rebase
automatically; conflicting edits are rejected with enough state to refresh/merge; undo/redo operates on committed
transactions (not raw network messages); default undo is project-global, identifying the originating window/user/
script/MCP client; a future collaboration model may extend this protocol with identity + CRDT/OT without changing
object IDs.

### 14A.11 Cross-Window Drag, Clipboard, and Focus

Application-level transfer model (native HTML DnD alone is insufficient): drag payloads carry stable object/asset
IDs + an expiring transfer token; the coordinator tracks the active drag + allowed operations; target windows
request a preview + commit a normal undoable command on drop; copy/paste uses an internal structured clipboard +
optional system-clipboard representations; large audio referenced by asset ID (not copied through messages);
global transport shortcuts work from any focused DAW window; text entry/plugin keyboard capture must not trigger
global shortcuts; a visible focus indicator shows which window owns keyboard routing + MIDI learn.

### 14A.12 Web Audio/MIDI/GPU/Storage Capability Matrix

The runtime publishes a capability manifest (no assumed parity). Reports: real-time audio backend + sample rate;
audio input/output availability + channel counts; output-device selection; AudioWorklet availability; cross-origin
isolation + shared-memory; Web MIDI + SysEx permission; native bridge status + version; VST3 hosting availability;
WebGPU/WebGL fallback tier; persistent storage + quota; PWA install/offline; multi-screen/window-management
capability + permission; MCP gateway availability.

| Capability | Native Studio | Web Standalone | Web + Native Engine |
|---|---|---|---|
| Sequencer, arranger, mixer, automation | Full | Full | Full |
| Built-in instruments/effects | Native portable core | WASM portable core | Native engine or WASM preview |
| Native VST3 | Full | Preserved placeholder only | Full through bridge |
| Professional audio drivers | Full | Browser-dependent | Full through bridge |
| Hardware MIDI | Full | Web MIDI where available | Full through bridge |
| Linked windows | Full | Full | Full |
| Fullscreen visualizer display | Full | Permission/capability dependent | Full browser or native visualizer |
| Offline project editing | Full | Full after assets cached | Full; bridge optional |
| External MCP clients | Local MCP server | Secure MCP gateway | Native bridge MCP server/gateway |

The UI must explain unavailable features + the exact path to enable them, and never silently omit devices,
routings, or export content.

### 14A.13 Web MCP Exposure

The full command surface stays MCP-addressable in every runtime via a gateway architecture: **Native Studio**
hosts the MCP server directly; **Web Standalone, integrated assistant** uses generated MCP-equivalent tool schemas
against the same command dispatcher; **Web Standalone, external MCP client** uses a signed local MCP Gateway app or
explicitly enabled secure hosted relay that forwards to the active browser session; **Web + Native Engine** hosts/
proxies the MCP server in the bridge. Gateway requirements: explicit pairing + revocation; OAuth/session-scoped
auth; tool-level permission scopes; user-visible connected-client list; approval policy synced across windows;
end-to-end command IDs + audit; no tool call succeeds until the command authority acknowledges the committed
revision; browser disconnection returns a clear unavailable result rather than queuing unbounded hidden edits.

### 14A.14 Security and Privacy

Serve web only in a secure context; strict CSP; cross-origin isolation headers where required for shared memory
with tested asset-loading rules; treat imported projects/audio metadata/presets/wavetables/plugin metadata/
visualizer packs as untrusted (parse in isolated workers/processes with bounds + resource limits); never allow
arbitrary unsigned JS in the real-time device graph; native plugins in sandboxed least-privilege processes; local
bridge loopback-only + reject unknown origins; short-lived pairing tokens, persistent credentials in platform
storage; MIDI SysEx/file access/microphones/display placement/remote MCP require explicit permission; every
connected window/bridge/script/MCP client visible + revocable; telemetry opt-in + never uploads project audio/MIDI
without a separate explicit workflow.

### 14A.15 Performance and Reliability Targets

≥8 linked UI windows per project without duplicate engines; a new local window reaches interactive synchronized
state within 2 s for a representative medium project after assets load; local edit acknowledgement normally within
one frame (p95 command-to-visible < 50 ms under normal load); visual playhead drift between visible windows < one
display frame after correction; hidden windows reduce rendering/subscription; closing any non-authority window has
no audio impact; closing the standalone web audio-authority window triggers explicit recovery/handoff without data
loss; bridge/window reconnection never duplicates an acknowledged command; audio xruns, bridge underruns, long UI
tasks, visualizer drops, message-queue pressure are measurable in a diagnostics panel; the visualizer reduces
quality before threatening audio stability; autosave/replication bounded and cannot block real-time processing.

### 14A.16 Packaging, Updates, Compatibility

Native: signed/notarized installers per platform; side-by-side-safe migrations; rollback-aware auto-update; plugin
scan DB isolated per architecture/platform; documented+tested Linux packaging/dependency policy. Web: installable
PWA manifest; versioned shell+cache; update coordinator preventing linked windows running incompatible schema in
one session; prompt to save/stop playback before a breaking reload; old-project migrations tested in browser
storage + portable import. Cross-platform release gates: same golden projects on all targets; built-in-device
renders compared to tolerances; save-on-one-target/reopen-on-every-other automated; multi-window chaos tests
(random open/reload/hide/disconnect/close while editing); bridge one-version-forward/back negotiation where
feasible; capability fallbacks tested not merely documented.

### 14A.17 Saved Workspace Layouts

First-class project/user assets: global/project-specific/template-provided; store logical roles, split ratios,
visibility, link groups, preferred display traits, fullscreen intent; no credentials in layouts; opening a layout
previews the windows it creates; launch all via one explicit action; missing displays consolidate; portable across
native/web where roles exist. Required factory layouts: single-screen compact; dual-screen arranger+mixer;
dual-screen sound design; triple-screen studio; performance + fullscreen visualizer; mixing+mastering;
LLM-assisted production with a dedicated activity/approval window.

### 14A.18 Accessibility Across Windows

Descriptive document title + role per window; valid keyboard navigation/focus order when panels detach;
screen-reader labels by stable semantic names (not coordinates); high-contrast + reduced-motion across linked
windows; visualizer photosensitivity-safe mode + intensity limits; "Gather windows", "Find focused window",
"Announce active workspace" keyboard-accessible; per-display zoom scaling preserving logical layout.

---

## 15. MCP Control Specification

The DAW runs an MCP server exposing the entire controllable feature set as discoverable tools, with project state
as resources and reusable prompts.

### 15.1 Principles

All MCP changes undoable; destructive ops require confirmation unless explicitly permitted; long ops return
progress resources; LLMs can inspect state before acting; LLMs propose **batches** of edits; the user previews +
approves edit plans; every operation logged; MCP can run headless or with UI visible.

### 15.2 Resources

`daw://project/summary`, `.../tempo-map`, `.../arrangement`, `.../tracks`, `.../patterns`, `.../clips`,
`.../mixer`, `.../devices`, `.../plugins`, `.../automation`, `.../modulation`, `.../visualizer`,
`.../export-settings`, `daw://selection/current`, `daw://history/undo-stack`, `daw://runtime/capabilities`,
`daw://runtime/audio-backend`, `daw://runtime/native-bridge`, `daw://session/summary`, `.../clients`,
`.../windows`, `.../audio-authority`, `.../command-authority`, `.../performance`, `daw://workspace/layouts`.

### 15.3–15.13 Tools (project, transport, sequencer, piano-roll/MIDI, arranger, mixer, devices/VSTs, automation,
modulation, visualizer, import/export, runtime/windows/displays/bridge)

Includes (non-exhaustive): `project.create/open/save/save_as/get_summary/set_metadata/export_package`;
`transport.play/stop/pause/record/set_position/set_loop/set_tempo/set_time_signature/enable_metronome`;
`sequencer.create_pattern/delete_pattern/duplicate_pattern/set_pattern_length/add_drum_lane/set_step/clear_step/
set_step_velocity/set_step_probability/set_step_microtiming/set_step_repeat/set_param_lock/randomize_pattern/
generate_euclidean_rhythm/apply_swing/apply_groove/create_fill/convert_pattern_to_clip`;
`midi.create_clip/add_note/update_note/delete_note/quantize/humanize/generate_chord_progression/
generate_bassline_from_chords/transpose/apply_scale/import_file/export_file`;
`arranger.create_section/update_section/delete_section/move_section/duplicate_section/place_clip/move_clip/
resize_clip/loop_clip/split_clip/consolidate_clip/mute_clip/group_clips/comp_take/expand_loop_to_song/
create_intro/create_breakdown/create_buildup/create_drop/add_variation_every_n_bars`;
`launcher.create_scene/launch_clip/launch_scene/set_follow_action/stop_clip`;
`mixer.create_track/delete_track/set_volume/set_pan/set_mute/set_solo/route_track/create_send/set_send_amount/
freeze_track/bounce_track`;
`device.add_builtin/remove/move/set_parameter/get_parameters/add_to_rack/set_macro`;
`modulation.add_modulator/assign/set_depth/remove`;
`plugin.scan/list/load_vst3/unload/get_parameters/set_parameter/create_macro_mapping/save_preset/load_preset`;
`automation.create_lane/add_point/set_points/delete_points/draw_shape/smooth/scale/copy/paste/record_mode`;
`visualizer.set_preset/set_palette/set_reactivity/bind_to_track/bind_to_master/set_mood_mode/
create_section_visual_plan/capture_frame/export_video(later)`;
`import.audio/midi`; `export.master/stems/loop/pattern/midi/project_package`;
`runtime.get_capabilities/get_audio_backend/get_performance_status/set_performance_profile`;
`bridge.discover/pair/connect/disconnect/get_status`;
`session.list_clients/disconnect_client/get_authorities/request_audio_authority_handoff`;
`workspace.list_windows/open_window/assign_role/focus_window/close_window/set_fullscreen/move_to_display/
set_link_group/save_layout/load_layout/gather_windows/reset_layout`. MCP clients operate on logical roles + stable
window IDs, never pixel coordinates for core control. Display placement, native plugin GUI interaction, mic
access, SysEx, and authority handoff may require explicit user approval.

### 15.14 Batch Edit Plan

LLMs prefer batch plans, e.g. a titled "Make second chorus bigger" with an ordered `operations` list
(arranger.duplicate_section, sequencer.add_drum_lane, automation.draw_shape) and `requires_user_approval: true`;
the UI shows a previewable change list before applying.

---

## 16. Data Model

### 16.1 Stable IDs

Stable IDs for: project, track, clip, pattern, note, automation lane, modulator, device, plugin instance,
parameter, visualizer preset, session, client, window, workspace layout, display capability, command,
transaction, audio authority, native bridge. IDs remain stable across saves so MCP workflows reference reliably.

### 16.2 Time Representation

Musical time internally: PPQ ticks for MIDI/arrangement; samples for audio scheduling; a tempo-map-aware
conversion layer between ticks and samples; warp markers map audio time to musical time.

### 16.3 Command, Event, Replication Model

Every mutating op is a versioned command envelope (`schema_version`, `command_id`, `transaction_id`, `session_id`,
`client_id`, `base_project_revision`, `tool`, `args`, `permission_scope`, `idempotency_key`). The authority
returns accepted/rejected, resulting revision, undo transaction ID, normalized result, conflict info, and a
progress handle for long work. Replication: ordered revisions; periodic snapshots + incremental events; idempotent
replay; schema migrations; state checksums; subscription filters for large projects; backpressure/coalescing for
high-rate parameter gestures; separate project/transport/analysis/window-local state; no dependence on UI
component instances for serialization.

---

## 17. Architecture

### 17.1 Layers

1. **Portable domain layer** — project objects, commands, events, validation, migrations, undo, stable IDs.
2. **Portable musical engines** — sequencing, arrangement, automation, modulation, tempo mapping, MIDI transforms,
   warp/groove.
3. **Portable DSP/device layer** — graph processing, built-in instruments/effects, presets, modulation runtime.
4. **Platform service layer** — audio/MIDI I/O, filesystem, credential store, window system, GPU, native plugin
   hosting.
5. **Session/control layer** — command authority, multi-window coordination, bridge, state replication, permissions.
6. **Presentation layer** — native/browser UI clients, visualizer, plugin generic editors, assistant panels.
7. **Automation layer** — MCP server/gateway, scripting, controller mappings, test harnesses.

### 17.2 Recommended Modules

Core: `core-project`, `core-schema-migrations`, `command-bus`, `event-log`, `undo-history`, `capability-registry`,
`tempo-timebase`. Musical engines: `audio-graph-core`, `midi-engine`, `arrangement-engine`, `sequencer-engine`,
`automation-engine`, `modulation-engine`, `warp-engine`, `groove-engine`, `mixer-engine`, `render-engine`.
Devices/plugins: `device-sdk`, `builtin-device-pack`, `wasm-device-runtime`, `plugin-host-vst3`, `plugin-scanner`,
`plugin-sandbox-manager`, `plugin-parameter-overlay`. Platform adapters: `audio-backend-{windows,macos,linux,web}`,
`midi-backend-{native,web}`, `project-storage-{native,web}`, `gpu-backend-{native,web}`,
`window-backend-{native,web}`. Session/distribution: `session-coordinator`, `state-replication`,
`window-role-manager`, `authority-election`, `native-engine-bridge`, `bridge-auth`, `meter-analysis-streams`. UI/
automation: `ui-design-system`, `ui-shell-native`, `ui-shell-web`, `visualizer-engine`, `asset-manager`,
`mcp-server`, `mcp-web-gateway`, `scripting-command-layer`, `controller-mapping`.

### 17.3 Non-Negotiable Architecture Rules

All UI/MIDI-mapping/scripting/bridge/MCP actions call the same command dispatcher; the audio thread never parses
network messages or project files; UI state is not the source of truth for project state; native+web use the same
project+command schema versions; every platform difference is a capability/adapter; built-in devices expose the
same parameter IDs across native+WASM; external plugins are optional project dependencies, never required to parse/
edit the rest of a project; multi-window support is part of the session model, not ad-hoc popup messages; MCP is
generated from / validated against the same typed command schemas; long ops support cancellation/progress/crash
recovery; all destructive mutations are transactional + undoable where semantically possible.

### 17.4 Process and Thread Model

Native: UI process(es); dedicated high-priority audio engine process/service; sandboxed plugin-host process(es);
background scanner/import/render workers; local MCP in the trusted app/engine service. Web standalone: one
engine-host window with AudioContext; AudioWorklet global scope for real-time DSP; SharedWorker/session coordinator
where available; dedicated workers for file parsing/waveform/analysis/offline; multiple UI windows via MessagePorts/
BroadcastChannel; Service Worker only for caching/update/offline. Bridge: native engine + plugin processes own
audio/MIDI/render; browser windows are UI clients; one authenticated bridge per session multiplexing logical
windows; no direct untrusted browser access to plugin processes.

### 17.5 Device SDK Contract

Every built-in/portable device defines: stable device type ID; versioned parameter schema; audio+event bus
declarations; state serialization/migration; real-time process interface; offline process interface; modulation
inputs; parameter display/unit formatting; automation capabilities; generic UI metadata; MCP semantic metadata;
native/WASM compatibility flags; determinism + latency declarations; preset compatibility policy. This contract
allows future third-party portable devices without changing arranger/automation/MCP/storage.

### 17.6 Capability-First Behavior

At startup and on hardware/permission change, build a capability graph; UI+MCP query it before presenting actions
(e.g. `audio.input.available`, `audio.output.device_selection`, `audio.backend.asio`, `midi.web.available`,
`midi.sysex.approved`, `plugin.vst3.hosting`, `bridge.connected`, `gpu.webgpu`, `storage.persistent`,
`window.multi_screen_placement`, `mcp.external_gateway`). Each capability has state, source, reason, permission
status, remediation — visible to users + LLMs.

### 17.7 Observability

Diagnostics view: audio CPU + callback timing; dropout/xrun count; plugin CPU + latency; audio authority + lease
status; command queue depth + revision; window/client list + heartbeat; bridge round-trip latency + reconnect
count; meter/analysis stream rate; storage quota + autosave health; GPU frame time + visualizer quality tier; MCP
client list + active scopes + recent tool calls. Exportable as a privacy-reviewed support bundle without project
audio by default.

---

## 18. Foundation Release Acceptance Criteria

The Foundation Release is convincing only when all of the following are demonstrably true.

**Music Production:** (1) create from blank + genre templates; (2) make a drum beat in the step sequencer; (3) add
bass/chords/leads/percussion/effects using only built-ins; (4) edit notes + expression in the piano roll; (5)
arrange a full song (intro/development/buildup/drop/breakdown/outro); (6) add automation clips + lanes + at least
one modulator; (7) record or import audio + MIDI; (8) mix with inserts/sends/sidechains/groups/master processing;
(9) freeze/bounce + export master + stems; (10) run the adaptive visualizer + bind visuals to sections.

**Native Cross-Platform:** (11) the same package opens/edits/saves/reopens on Win/macOS/Linux; (12) built-in
devices preserve parameter IDs/presets/automation/sound within tolerances across targets; (13) each native target
loads a matching VST3 instrument + effect, automates, saves state, survives a plugin crash without losing the
project; (14) a project with a missing platform-specific plugin opens with a preserved placeholder + frozen
fallback.

**Web Standalone:** (15) in a supported browser, create + complete a song with sequencer/arranger/mixer/automation/
built-ins/visualizer/export without a native engine; (16) save in browser persistence, reload, recover, export a
portable package; (17) work offline after shell + selected factory assets cached; (18) use browser MIDI when
available or get a clear capability explanation + alternative input path.

**Linked Multi-Window / Multi-Screen:** (19) open arranger+mixer+visualizer in three linked browser windows; (20)
edit a track in one window + see authoritative state update in the others without duplicate commands; (21) start/
stop/seek transport from any focused window while exactly one audio authority produces sound; (22) run the
visualizer fullscreen on another display when permitted with a manual fallback; (23) reload a secondary window +
rejoin at the current revision; (24) close a non-authority window with no audio interruption; (25) close the
standalone web audio-authority window + complete the recovery/handoff without data loss; (26) save + restore a
dual/triple-screen layout.

**Web + Native Engine:** (27) pair browser + native engine through an authenticated local flow; (28) select native
audio/MIDI devices from a browser window; (29) load a VST3 in the native engine, expose every discoverable
parameter to browser generic UI + MCP, automate it, restore state; (30) disconnect + reconnect the bridge without
duplicating acknowledged edits.

**MCP and Safety:** (31) ask an LLM over MCP to inspect the project + propose a reversible arrangement change;
(32) preview/approve/apply/undo the change from any linked window; (33) external MCP clients discover runtime
capabilities/windows/authorities/devices/plugins/project state; (34) MCP tool behavior is identical local/gateway/
bridge; (35) revoke an MCP client/bridge/linked window immediately.

**Reliability:** (36) save/close/reopen preserves all state; (37) recover from simulated UI-window + plugin-host
crashes; (38) autosave never blocks the audio callback; (39) multi-window chaos tests complete without corruption
or duplicate transaction application; (40) cross-platform golden-project + migration tests pass.

---

## 19. Development Roadmap

Cross-platform + web are horizontal requirements, not a late port. Every phase keeps the native + web contracts
compiling, serializing, and passing shared tests even when a particular adapter is not yet feature-complete.

- **Phase 0 — Product Contracts + Spikes:** project schema + migration policy; stable IDs; command/event/undo
  protocol; capability schema; portable device SDK contract; native audio proof on all three OS families;
  AudioWorklet + portable DSP proof; SharedWorker/BroadcastChannel multi-window proof; native bridge security +
  latency proof; VST3 sandbox proof; WebGPU visualizer proof. **Exit gate:** one oscillator/device controlled
  through the same command + parameter schema in native, WASM, a second browser window, and the MCP test harness.
- **Phase 1 — Portable Engine Foundation:** audio graph core; MIDI engine; tempo/timebase; project save/load on
  native + web storage adapters; track graph + mixer basics; undo/redo transactions; capability registry; native
  audio backends; Web Audio/AudioWorklet backend; single audio authority.
- **Phase 2 — Sequencer, Piano Roll, Rhythm Core:** pattern model; drum step sequencer (+ param locks); piano
  roll; MIDI recording + capture; built-in drum synth + sample player; cross-platform preset/automation tests;
  browser + bridge MIDI adapters.
- **Phase 3 — Full Arranger, Mixer, Linked Workspaces + Clip Launcher:** timeline/clips/sections/markers; pattern
  placement + arrangement editing + comping; automation lanes + modulation; mixer routing/sends/sidechains; clip-
  launch scenes + follow actions; detachable workspaces; browser session coordinator; command replication +
  reconnect; saved window/display layouts; multi-window transport + meter sync.
- **Phase 4 — Native VST3 Hosting + Web Engine Bridge:** scan/database; load instruments/effects; plugin UI +
  generic overlay; parameter automation; state save/restore; crash isolation; secure bridge pairing + capability
  negotiation; browser control of native audio/MIDI/VST3; missing-plugin placeholders + frozen fallbacks.
- **Phase 5 — Flagship Instruments, Effects, Factory Content:** EQ/comp/delay/reverb/saturation/limiter; Nova;
  SubForge; PulseLab; Atlas; TribeGrid; MIDI generators; preset browser; templates + packs; native/WASM golden
  renders + perf tuning; modulation system + device racks; warp + groove engines.
- **Phase 6 — Adaptive Visualizer + GPU Surfaces:** audio analysis; visual presets; mood adaptation; visualizer
  tracks/clips; dedicated linked visualizer window; WebGPU/native GPU + fallbacks; dynamic quality scaling.
- **Phase 7 — MCP Full Control + Web Gateway:** resources/tools/prompts; batch edit plans; plugin parameter
  overlay; safety/approval system; LLM assistant panel; runtime/window/display/bridge tools; native local MCP
  server; signed local web MCP gateway; full audit + revocation.
- **Phase 8 — Hardening, Export, Accessibility, Release Engineering:** stem export + freeze/bounce; performance;
  crash recovery; browser storage recovery + quota UX; multi-window chaos testing; accessibility across linked
  windows; signed installers + PWA updates + migration tests; UI polish + factory layouts; cross-platform launch
  demo projects.

Each phase finishes with an end-to-end musical workflow, not only isolated infrastructure.

---

## 20. Long-Term Growth Toward FL-Studio Scale

Future expansion: full audio warping + transient editing; advanced/granular sampler; deeper wavetable editor;
modular device rack/grid; pitch correction; score editor; advanced mixer snapshots; performance mode; cloud
projects; collaboration; marketplace; scripting + plugin SDKs; controller scripting; touch UI; visualizer video
export; AI-assisted sound design/mixing/arrangement; genre templates; stem separation; audio-to-MIDI; chord/key/
beat detection; remote linked control surfaces; multi-user real-time collaboration over the existing command/event
protocol; cloud sync with E2E encryption; browser live-performance rooms; distributed offline rendering; portable
signed third-party WASM device ecosystem; remote visualizer/stage-display nodes; mobile companion using the same
workspace + MCP contracts; cross-device layouts + controller handoff.

---

## 21. Core Product Promise

A fast, beautiful, pattern-first **and** timeline-first **and** clip-launch professional DAW with a real song
arranger, flagship built-in instruments, a modulation system, serious native VST support, a genuinely capable
browser edition, linked multi-window/multi-screen workspaces, adaptive visuals, and an MCP-native control surface
that lets LLMs operate the DAW as deeply as a human power user — safely, visibly, reversibly, and through the same
project on Windows, macOS, Linux, and the web.

---

## 22. Competitive Parity Matrix — Match-or-Exceed the Major DAWs

The Foundation Release architecture must be capable of every signature workflow below. Items marked **F** are
Foundation-Release scope; **L** are later but must not be architecturally precluded.

### 22.1 Ableton Live
- **F** Session view / clip launcher with scenes, quantized launch, and **follow actions**.
- **F** Arrangement view (linear) coexisting with Session, with capture-to-arrangement.
- **F** Audio **warping** with multiple modes (Beats, Tones, Texture, Re-Pitch, Complex/Pro-class).
- **F** **Groove pool** (extract/apply groove, timing + velocity + random, groove amount).
- **F** Instrument/Audio-effect/Drum **Racks** with macro controls + chain selectors.
- **F** Device **modulation** (LFO/Envelope/Shaper as assignable modulators).
- **F** **MIDI capture** (retroactive). **F** Comping.
- **L** Max-for-Live-class modular device environment (see §23). **L** Push hardware integration. **L** Tempo-
  follow / jam features.

### 22.2 FL Studio
- **F** Best-in-class **piano roll** (the §4.4 feature set is the bar) including chords/scales, strum, arp,
  LFO-tool, ghost notes, slide notes.
- **F** Pattern blocks + Playlist with free clip placement (FL's flexible playlist model).
- **F** Per-mixer-track effect chains + flexible routing + sidechain.
- **L** Patcher-class modular environment (see §23). **L** Edison-class audio editor (record/edit/convolve).
- **L** Gross-Beat-class time/volume manipulation device. **L** Slicex/Fruity Slicer-class beat slicing (basic
  slicing is **F** in Atlas). **L** Newtone-class pitch/time editor.

### 22.3 Bitwig Studio
- **F** Unified **modulation system** (many modulators, nestable, audio-rate where possible) — the §6.4 bar.
- **F** Nested/containerized devices + device racks.
- **F** Clip launcher + arranger hybrid editing.
- **L** **The Grid**-class modular sound-design environment (see §23). **L** Per-note expressions everywhere +
  micro-pitch. **L** Operators / note-FX as first-class. **L** Hardware/CV integration.

### 22.4 Logic Pro
- **F** Take recording + **comping** (the §5.3 comp lanes are the bar).
- **F** **Smart Tempo** / tempo detection from audio + project tempo adaptation.
- **F** Track stacks (folder/summing groups) + bus routing.
- **L** Flex Time + **Flex Pitch** (audio pitch/time editing) — basic warp is **F**, studio-grade tuning **L**.
- **L** Drummer-class generative drummer. **L** Alchemy-class synth depth (Nova covers core synthesis). **L**
  Live Loops (clip-launch is **F**). **L** Score editor (see §24).

### 22.5 Cubase / Nuendo
- **F** Chord track + scale assistant influencing MIDI + a chord-pad performance surface.
- **F** Powerful **logical/transform editor** for MIDI (selection-based programmable transforms).
- **F** Pro mixer (channel strip, inserts, sends, groups), control-room-ready monitoring model.
- **L** VariAudio-class pitch editing. **L** Expression Maps / articulation management (data model **F**, full UI
  **L**). **L** Full **score/notation** editor (see §24). **L** Control Room with cue mixes.

### 22.6 Studio One
- **F** Drag-everything workflow; **Scratch Pad** (sketch alternate arrangement ideas off to the side);
  **Arranger track** for section reordering.
- **F** Chord track. **F** Integrated **mastering**/project assembly page (see §25).
- **L** Impact/Mai Tai/Presence-class devices (Nova/PulseLab/Atlas cover core needs). **L** Show page (live).

### 22.7 Reason
- **L** Rack with **virtual cabling** (back-of-rack patching) — the modular environment (§23) should be able to
  express this. **L** Combinator-class device combiner with macro mapping (device racks + macros are **F**). **L**
  The signature Reason instruments (covered functionally by built-ins).

### 22.8 Reaper
- **F** Extreme routing flexibility — a **routing matrix** (any-to-any with feedback detection), per-track FX +
  **per-item/clip FX**, folder tracks, freeze, multi-output render.
- **F** **Render matrix** (batch render stems/regions/formats in one pass).
- **L** ReaScript-class user scripting (the MCP/command layer + a sanctioned scripting surface is the path). **L**
  Fully customizable UI themes/actions (command palette + remappable actions is **F**).

### 22.9 Cross-cutting "table-stakes every modern DAW has"
- **F** Time-stretch + pitch-shift on clips; tempo/time-signature map; warp markers.
- **F** Sidechain compression with visible ducking; ducking-ready built-ins.
- **F** Comprehensive **metering** (peak/RMS/LUFS-M/S/I/true-peak/correlation/goniometer/spectrum) — §2 item 35.
- **F** Loudness-target export normalization (e.g. streaming targets).
- **F** Track freeze + bounce + flatten; consolidate; render-in-place.
- **F** Project-wide search + command palette; remappable key commands; macro/controller mapping.
- **F** Non-destructive editing + global undo across all surfaces incl. scripting/MCP.
- **F** Reference-track / A-B monitoring helper (basic).
- **L** Audio-to-MIDI (melody/chord/drum extraction); stem separation; vocal tuning; spectral repair; surround.

---

## 23. Modular Device Environment *(architecture-ready in Foundation; full UI later)*

A modular environment that can express Bitwig's Grid, FL's Patcher, and Reason's rack-cabling at the model level:
- A **device-graph container** device whose internal graph is the same audio/MIDI/modulation graph used at track
  level (recursion), with typed audio/CV/MIDI/gate ports and **back-of-rack-style patch cables**.
- A library of primitive nodes (oscillators, filters, math/logic, envelopes, sequencers, sample-and-hold, mixers,
  scalers, quantizers, delays, comparators) with the §17.5 device SDK contract so they are native+WASM portable.
- Containers expose macros + a generic UI + MCP control like any device; presets serialize the full inner graph.
- Foundation Release ships the data model, serialization, MCP exposure, and a minimal builder; the rich visual
  patching UI and large primitive library are §20 growth, but **the project/preset format must already represent
  modular graphs** so later UIs need no schema break.

---

## 24. Score / Notation *(model now, editor later)*
- The MIDI/event model must be **notation-ready**: enharmonic spelling hints, voices, tuplets, key/clef hints,
  articulation/expression maps, dynamics. Foundation ships an **event-list / step editor**; the engraved score
  editor and printing are §20 growth but must not require a model break.

## 25. Mastering / Project-Assembly Page *(basic now)*
- A project/mastering surface to assemble exported songs into an album/order with per-song gain, fades, spacing,
  metadata, master chain, and **loudness normalization to a target** with true-peak limiting; full
  redbook/DDP/marketplace is later.

## 26. Advanced Audio Editing *(scoped)*
- **F**: clip gain envelopes, fades/crossfades, slip/trim, consolidate, reverse, normalize, silence, time-stretch,
  pitch-shift (semitones), basic transient detection + slicing, comping.
- **L**: studio-grade pitch/time (Flex/VariAudio class), spectral edit/repair, source separation, audio quantize
  to grid/groove from transients (basic audio-quantize is **F**).

## 27. Tempo, Sync, and Groove
- **F**: tempo map + ramps; time-signature map; tempo **detection** from audio + warp; metronome/pre-roll/count-in;
  groove pool (extract/apply, strength); humanize. **L**: Ableton-Link network sync; smart-tempo conducting.

## 28. Performance & Live
- **F**: clip-launch scenes, quantized launch, follow actions, MIDI/controller mapping, big-meter performance
  view, "panic". **L**: dedicated Show/Performance page, setlists, crossfader/cue, tablet remote.

## 29. Hardware & Control Surfaces
- **F**: MIDI learn + mapping profiles; generic controller mapping; transport/jog; pad/keyboard input. **L**:
  deep scripted controller integration (Push/Maschine-class), CV/gate, MPE controllers end-to-end.

## 30. Quality, Testing & SOTA Engineering Bar

This project is used to measure whether an autonomous system + LLM can produce **state-of-the-art** work. The
expected bar:
- **Real DSP, not stubs.** Synthesis/effects implement actual algorithms (proper anti-aliasing/oversampling on
  nonlinear stages, denormal handling, no aliasing artifacts in audible range under golden tests).
- **Determinism + golden renders** for every device/engine path, with documented numeric tolerances; CI compares
  native vs WASM within tolerance.
- **Real-time safety** proven by tests/guards (no allocation/locks/IO on the audio path; graph swaps atomic).
- **Phase/loudness correctness** validated (kick/bass phase alignment; LUFS/true-peak metering accuracy vs known
  references; sidechain ducking measurable).
- **Schema/migration tests**: save on one version/platform, open on every other; forward/back-compat for the
  command protocol and bridge.
- **Multi-window chaos + crash-recovery tests** (no corruption, no duplicate transactions, authority handoff
  correct).
- **Capability fallbacks tested, not just documented** (web without Web MIDI, no WebGPU, no shared memory, no
  persistent storage; native without ASIO, missing plugin).
- **Security tests** (untrusted file parsing isolation, bridge auth/origin, no unsigned JS in the RT graph).
- **Accessibility + performance budgets** met and measured (§14A.15/14A.18).
- **Documentation** that teaches the architecture: each module documents its contract, invariants, and the domain
  knowledge it depends on (cite the DSP/standard/SDK source).

---

## 31. Acceptance Command (for this dev-test fixture)

Run `npm test` successfully. Implementation cards are expected to grow real, tested TypeScript modules (engine
contracts, device DSP cores, command/automation/modulation models, MCP tool schemas, capability registry, and
golden/deterministic tests) starting from the provided starter, decomposed into a coherent dependency-linked DAG —
not a single shallow file. Partial, honest, well-tested vertical slices that respect the architecture are far more
valuable than a wide layer of fake stubs.
