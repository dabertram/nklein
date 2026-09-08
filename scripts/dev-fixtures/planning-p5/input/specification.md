# Fleet Telemetry Platform — specification

Telemetry from a few thousand vehicles: frames in over a lossy link, stored as time series, resampled into trips
and fuel figures, watched by alert rules, and served back to operations and compliance. One deployment, one region,
no multi-tenant story.

Every obligation names the module or document its implementation belongs in, written `[module: <path>]`. An
obligation whose implementation consumes another module also says so, written `[uses: <path>]`; those annotations
are the import graph of the finished platform. Obligations discharged by writing prose rather than code are marked
`(documentation-only)`.

This specification is larger than one card's worth of anything, and the plan for it has a hard size limit.

Card ceiling: 30 cards.

## Obligations

- **OBL-01** — Physical quantities MUST carry their unit, and arithmetic between incompatible units MUST fail
  rather than coerce. [module: src/core/units.js]
- **OBL-02** — Conversion between metric and imperial units MUST be exact to the stored precision and MUST round
  half-even exactly once. [module: src/core/units.js]
- **OBL-03** — Device timestamps MUST be normalised to UTC, and a frame whose clock is ahead of the gateway by more
  than a configured skew MUST be quarantined. [module: src/core/time.js]
- **OBL-04** — Elapsed time MUST be computed from a monotonic source so that a device clock correction cannot
  produce a negative duration. [module: src/core/time.js]
- **OBL-05** — A device MUST be identified by its hardware id and a vehicle by its VIN, and the mapping between
  them MUST be versioned in time. [module: src/core/ids.js]
- **OBL-06** — Coordinates MUST be stored as WGS84 with a recorded accuracy, and a fix worse than a configured
  accuracy MUST be marked untrusted rather than dropped. [module: src/core/geo.js]
- **OBL-07** — Distance between two fixes MUST use a great-circle calculation, and MUST return zero rather than a
  rounding artefact for identical points. [module: src/core/geo.js]
- **OBL-08** — The frame codec MUST decode the binary telemetry frame, and MUST reject a frame whose checksum fails
  without consuming the rest of the buffer.
  [module: src/ingest/frame-codec.js] [uses: src/core/units.js] [uses: src/core/time.js]
- **OBL-09** — An unknown frame version MUST be preserved verbatim for later decoding rather than discarded.
  [module: src/ingest/frame-codec.js]
- **OBL-10** — The gateway MUST accept frames out of order and MUST deduplicate a frame redelivered after a link
  drop. [module: src/ingest/gateway.js] [uses: src/ingest/frame-codec.js] [uses: src/core/ids.js]
- **OBL-11** — The gateway MUST apply per-device backpressure, shedding the oldest low-priority frames first and
  recording what it shed. [module: src/ingest/gateway.js]
- **OBL-12** — A device reconnecting after an outage MUST be able to backfill its buffered frames without
  overwriting frames already stored.
  [module: src/ingest/backfill.js] [uses: src/ingest/frame-codec.js] [uses: src/core/time.js]
- **OBL-13** — The time-series store MUST append points per device and signal, and MUST reject a point older than
  the retention horizon. [module: src/store/timeseries.js] [uses: src/core/time.js]
- **OBL-14** — A read of a device-and-signal range MUST return points in time order with no duplicates, whatever
  order they arrived in. [module: src/store/timeseries.js]
- **OBL-15** — Retention MUST downsample beyond a configured age rather than delete, and MUST record what was
  downsampled. [module: src/store/retention.js] [uses: src/store/timeseries.js]
- **OBL-16** — The catalog MUST list which signals a device has ever reported and when each was last seen.
  [module: src/store/index-catalog.js] [uses: src/core/ids.js]
- **OBL-17** — Resampling to a fixed cadence MUST be deterministic and MUST not invent a sample where no data
  exists. [module: src/process/resample.js] [uses: src/store/timeseries.js] [uses: src/core/units.js]
- **OBL-18** — A resampled series MUST record the number of source points behind each output sample.
  [module: src/process/resample.js]
- **OBL-19** — Gaps shorter than a configured threshold MUST be interpolated and marked as interpolated; longer
  gaps MUST stay gaps. [module: src/process/gapfill.js] [uses: src/process/resample.js]
- **OBL-20** — A trip MUST start at ignition-on and end at ignition-off, and MUST survive a telemetry gap in the
  middle without splitting. [module: src/process/trip.js] [uses: src/core/geo.js] [uses: src/process/resample.js]
- **OBL-21** — Trip distance MUST be computed from trusted fixes only, and the proportion of untrusted fixes MUST
  be reported with it. [module: src/process/trip.js] [uses: src/core/geo.js]
- **OBL-22** — Fuel consumption MUST be derived per trip and MUST be rejected as implausible outside a configured
  band. [module: src/process/fuel.js] [uses: src/core/units.js] [uses: src/process/trip.js]
- **OBL-23** — A geofence MUST be a closed polygon, and containment MUST be decided consistently for a point
  exactly on an edge. [module: src/process/geofence.js] [uses: src/core/geo.js]
- **OBL-24** — Entering and leaving a geofence MUST each produce one event, with hysteresis so a vehicle parked on
  the boundary does not flap. [module: src/process/geofence.js] [uses: src/core/geo.js]
- **OBL-25** — An alert rule MUST be expressible over a signal, a threshold and a duration, and MUST evaluate the
  same way on live and replayed data. [module: src/alert/rules.js] [uses: src/process/resample.js]
- **OBL-26** — A rule MUST be versioned, and an alert MUST record the rule version that fired it.
  [module: src/alert/rules.js]
- **OBL-27** — Repeated firings of the same rule for the same device MUST collapse into one open alert until it
  clears. [module: src/alert/dedupe.js] [uses: src/alert/rules.js] [uses: src/core/time.js]
- **OBL-28** — Alert delivery MUST retry with backoff and MUST be idempotent at the receiver.
  [module: src/alert/delivery.js] [uses: src/alert/dedupe.js]
- **OBL-29** — A delivery channel that fails repeatedly MUST be quarantined without stopping delivery on other
  channels. [module: src/alert/delivery.js]
- **OBL-30** — An alert unacknowledged past its deadline MUST escalate exactly once per level.
  [module: src/alert/escalation.js] [uses: src/alert/delivery.js]
- **OBL-31** — The utilisation report MUST show driving, idle and parked time per vehicle per day, summing to the
  day. [module: src/report/utilisation.js] [uses: src/process/trip.js]
- **OBL-32** — The utilisation report MUST be reproducible: the same day over the same data MUST produce a
  byte-identical report. [module: src/report/utilisation.js]
- **OBL-33** — The compliance report MUST show driving hours against the configured limit and MUST state the data
  coverage it was computed from.
  [module: src/report/compliance.js] [uses: src/process/trip.js] [uses: src/store/retention.js]
- **OBL-34** — The query API MUST page deterministically over a device-and-signal range and MUST not repeat or drop
  a point. [module: src/api/query.js] [uses: src/store/timeseries.js]
- **OBL-35** — A query for a signal a device never reported MUST return an empty result, not an error.
  [module: src/api/query.js] [uses: src/store/index-catalog.js]
- **OBL-36** — The device API MUST show connection state, last frame time and shed-frame count for each device.
  [module: src/api/devices.js] [uses: src/ingest/gateway.js]
- **OBL-37** — A time range MUST be replayable from stored frames, producing identical processed output.
  [module: src/ops/replay.js] [uses: src/ingest/backfill.js] [uses: src/process/gapfill.js]
- **OBL-38** — Operational metrics MUST expose ingest lag, store write latency and alert delivery success rate.
  [module: src/ops/metrics.js] [uses: src/alert/delivery.js]
- **OBL-39** — The retention and downsampling policy MUST be written down, including who may change it and what
  evidence a change requires. (documentation-only) [module: docs/data-retention.md]
- **OBL-40** — Each alert class MUST have a runbook entry saying what it means, what to check and when to
  escalate. (documentation-only) [module: docs/alert-runbook.md]
- **OBL-41** — Device onboarding MUST be documented end to end, from hardware id allocation to first accepted
  frame. (documentation-only) [module: docs/device-onboarding.md]
- **OBL-42** — The privacy notice MUST state what location data is kept, for how long, and who can read it.
  (documentation-only) [module: docs/privacy-notice.md]

## Non-goals

Multi-region deployment, video telemetry, driver-behaviour scoring and a mobile app are all out of scope.
