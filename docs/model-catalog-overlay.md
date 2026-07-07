# Model-catalog overlay (user-editable, data-driven)

!Klein carries a curated model-capability catalog in code, but the local-model landscape churns fast — new fine-tunes
land weekly and quantizations vary. So the catalog is **data-driven**: you can add new models or override a shipped
verdict from an **editable file, no rebuild required**. Entries in your overlay are consulted **before** the shipped
catalog, so they win.

## Location

`~/.nklein/nklein/model-catalog-overlay.json` (the runtime home; loaded at server startup). Missing file = no overlay
(normal). Malformed entries are **skipped with a logged reason** — one typo never blanks the whole file.

## Format

```jsonc
{
  "version": 1,
  "models": [
    {
      "family": "qwen3.6-27b",            // required: stable slug for messages/telemetry
      "match": "qwen3\\.6-27b",           // required: regex SOURCE, matched case-insensitively against the model id
      "toolUse": "TOOL_NATIVE",           // required: TOOL_NATIVE | TOOL_CAPABLE | TOOL_WEAK | TOOL_UNSUITABLE | UNKNOWN
      "kind": "reasoning",                // required: reasoning | code | agentic | instruct | chat | roleplay | unknown
      "chaining": "native",               // optional: native | via_force | single_only | fails | unknown
      "synthesis": "full",                // optional: full | weak | unknown
      "structuredOutput": "native_tool_call", // optional: json_schema | json_schema_deadend | native_tool_call | unknown
      "speed": "medium",                  // optional: fast | medium | slow | unknown  (a §5.AB tie-breaker)
      "sizeGb": 28,                       // optional: resident footprint (packing/placement input)
      "selfScaffolding": false,           // optional: model authors its own scaffold (soften force-advance)
      "severityOverride": "ok",           // optional: ok | warn | reject | unknown (hard gate override)
      "disqualifiers": [],                // optional: extra reasons surfaced in the gate message
      "note": "Dense 27B; strong repo-level agentic coding.", // optional (defaults to "")
      "sources": ["https://huggingface.co/Qwen/Qwen3.6-27B"], // optional (defaults to [])
      "basis": "research",                // optional: research | empirical | both (defaults to "research")
      "verified": false                   // optional: false marks an unconfirmed / past-cutoff verdict
    }
  ]
}
```

Order matters within `models`: the **first** matching entry wins, so list specific patterns before general ones (e.g.
`qwen3.6-35b-a3b` before a broad `qwen3.6`).

## Seed example (web-verified mid-2026 — adjust to what you actually run)

These are real releases; `verified: false` marks verdicts not yet confirmed by a local sweep. Family for diversity is
the **base lineage**, not the label (a Qwen fine-tune is Qwen for review-diversity purposes).

```json
{
  "version": 1,
  "models": [
    { "family": "qwen3.6-27b", "match": "qwen3\\.6-27b", "toolUse": "TOOL_NATIVE", "kind": "reasoning", "speed": "medium", "sizeGb": 28, "note": "Dense 27B; deep judge / architect.", "sources": ["https://huggingface.co/Qwen/Qwen3.6-27B"], "basis": "research", "verified": false },
    { "family": "qwen3-coder-next", "match": "qwen3-coder-next", "toolUse": "TOOL_NATIVE", "kind": "code", "speed": "fast", "sizeGb": 46, "note": "80B-A3B MoE; fast implementer.", "sources": ["https://huggingface.co/Qwen/Qwen3-Coder-Next"], "basis": "research", "verified": false },
    { "family": "devstral-small-2507", "match": "devstral-small-2507", "toolUse": "TOOL_NATIVE", "kind": "agentic", "speed": "medium", "note": "Mistral family — a DIVERSE (non-Qwen) reviewer.", "sources": ["https://huggingface.co/mistralai/Devstral-Small-2507"], "basis": "research", "verified": false }
  ]
}
```

The `match` is a JSON string, so escape backslashes (`\\.` for a literal dot). Keep `verified: false` until a local
run confirms the verdict; !Klein surfaces unverified entries honestly.
