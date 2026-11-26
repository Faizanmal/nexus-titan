# Synthetic telemetry

## Fixture and detector

`python scripts/generate-telemetry.py --check-deterministic` compares two in-memory generations for seed `20261115`. Run `python scripts/generate-telemetry.py` to write public samples, a separate holdout-label file, and detector metrics under `tests/fixtures/telemetry/TITAN-WTP-01/`. The labels contain only asset/metric/sample sequence/fault type; public samples have no fault label. Do not copy the holdout file into a service image, browser bundle, API response, or model context.

The default fixture has 24 synthetic pump series, four metrics, 240 samples per series, 15-second nominal spacing, deterministic Gaussian noise, independent quality flags, and 1.5% missing values. Four faults are injected: sustained pressure high, vibration spike, sustained flow low, and temperature drift. Missing samples have a null value; unit/metric combinations and quality/value consistency are enforced by the v1.3 schema and SQL constraints. Out-of-order arrival is safe because the persisted sample key is timestamp-based and the detector sorts each series before evaluation.

The detector freezes the initial 30 valid values as baseline and computes `(value - median) / (1.4826 * MAD)` with a nonzero numerical floor. `abs(robust_z) >= 6` is a point anomaly. A canonical incident requires at least three anomalies in the last five valid points and is rate-limited by a 15-minute cooldown per asset/metric. The numeric path uses no LLM. `scripts/generate-telemetry.py` emits precision/recall and confusion counts against held-out labels; these are synthetic benchmark results, not plant performance claims.

## Local run

Start Docker Compose `core`, apply migrations and seed identity/world fixture first. Then run:

```powershell
python scripts/task.py telemetry-simulate --tenant demo-nexus --confirm demo-nexus --seed 20261115 --steps 240 --batch-size 500 --throttle-ms 5
```

The task only runs in local mode and only for the confirmed `demo-nexus` tenant. It validates before inserting bounded batches. Duplicate timestamp keys are ignored, and simulator-generated alert incidents use the canonical event append/outbox path; the public signed device-sync endpoint still rejects `source=simulator`. Start the distributed profile to relay the outbox to NATS.

The authenticated `GET /v1/world/telemetry` endpoint requires Firebase ID token and App Check via the shared identity dependency. It repeats membership/site scope checks, restricts metric IDs to the fictional pump fixture, returns aligned time buckets (mean/min/max/count), preserves missing buckets and quality flags, caps the query at 30 days / 10,000 points, and reports stale/no-data state. `/telemetry` renders these API values in an SVG chart and accessible table.

The additive `004_synthetic_telemetry.sql` migration stores derived fixture samples and alert deduplication records. Samples target a 90-day retention window and can be pruned explicitly for the demo tenant only:

```powershell
python scripts/task.py telemetry-prune --tenant demo-nexus --confirm demo-nexus --retention-days 90
```

There is no automated deletion scheduler. Pruning never deletes canonical events or alert-deduplication records. No MQTT broker, external PLC/SCADA connection, Timescale extension, real operating data, or paid service is used.
