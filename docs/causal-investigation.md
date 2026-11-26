# Causal investigation (synthetic fixture)

The feature ranks deterministic candidate hypotheses from the synthetic TITAN-WTP-01 graph and telemetry. It is not a diagnostic system and provides no operational advice. Relative support points are transparent fixture weights, not calibrated probability or confidence.

`FEEDS` is traversed source to target. `DEPENDS_ON` is traversed prerequisite to dependent asset. Only those relations are used. The current evidence score uses a robust-z absolute threshold of 6, up to five repeated samples (+6 each), up to two independent anomalous metrics (+6 each), a directed path to the incident scope (+15), timing conflicts (-20), suspect quality (-4), isolated spike (-15), and single-channel drift (-8). Scores are bounded to 0–100. The first 30 samples in each series define the existing detector baseline; anomaly detection and ranking weights are not calibrated against real plant conditions.

The engine reports missing evidence, contradictory citations, and candidate timing conflicts. A `hypothesis` state never means verified cause. No role/model provider is invoked by this endpoint because there is no entitled structured causal inference adapter available. Human or independently simulated observation is required before treating claims as verified.

`POST /v1/causal/investigations` accepts `tenant_id`, `site_id`, `incident_id`, and a bounded `idempotency_key`. Owner/admin/operator access is required. It reads only canonical incident evidence and telemetry within the authorized tenant/site, with a 30-day and 20,000-row bound. Repeating the idempotency key returns the stored snapshot. GET list/detail endpoints retain tenant/site scope.

The hidden synthetic labels are available only to the offline evaluator. The runtime API and causal engine do not import or read holdout labels. Evaluator output is a small fixture measurement only. Required reference prompts are currently missing, so relation semantics and ranking assumptions remain provisional.

## Security and limitations

- Site authorization and classification filtering occur before reads; viewers may read investigations but cannot start them.
- The API requires a canonical `incident.created` record and validates every telemetry citation before persistence.
- This feature is limited to synthetic data. It does not ingest restricted records or advise operations.
- Tenant/site query isolation, migration FKs, real database behavior and browser rendering still require live acceptance checks.
