# 70_integration_at_least_once_event_consumer — recorded scenario set

Recorded from a real HITL rig drive (requests 2842+ of `/Users/david/.nklein/factory-drains/hitl-drain/queue`), reshaped by
`scripts/hitl-record-project.mts`. Every turn here is a response a real model actually produced against the
real runtime; nothing was authored to make the replay pass.

- pairs captured: 7
- distilled tracks: 7

## Replay

```bash
NKLEIN_SIMFLOW_SCENARIO=70_integration_at_least_once_event_consumer npx tsx scripts/verify-simulated-flow.mts
```

A track that has never been replayed is not a test. If this set stops passing, the runtime changed shape:
fix the runtime or re-record the drive — do not hand-edit a track to make it pass.
