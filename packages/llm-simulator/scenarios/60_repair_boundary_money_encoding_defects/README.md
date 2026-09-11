# 60_repair_boundary_money_encoding_defects — recorded scenario set

Recorded from a real HITL rig drive (requests 2673+ of `/Users/david/.nklein/factory-drains/hitl-drain/queue`), reshaped by
`scripts/hitl-record-project.mts`. Every turn here is a response a real model actually produced against the
real runtime; nothing was authored to make the replay pass.

- pairs captured: 44
- distilled tracks: 44

## Replay

```bash
NKLEIN_SIMFLOW_SCENARIO=60_repair_boundary_money_encoding_defects npx tsx scripts/verify-simulated-flow.mts
```

A track that has never been replayed is not a test. If this set stops passing, the runtime changed shape:
fix the runtime or re-record the drive — do not hand-edit a track to make it pass.
