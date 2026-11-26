# Synthetic numerical simulation

## Scope and inputs

The endpoint uses a compact fictional three-node hydraulic circuit (`source_main`, `junction`, `consumer`) with fixed 450 kPa gauge source head, 4 m³/h withdrawal, resistances 20 and 30 kPa/(m³/h), synthetic capacity 6 m³/h and service-pressure proxy threshold 200 kPa. It is tied to an authorized, canonical `TITAN-WTP-01` topology version and stores both that version and a SHA-256 of the exact solver input. The hydraulic circuit is not claimed to be the actual fixture plant layout.

The repository does not contain pipe lengths/diameters/roughness, pump curves, reservoir levels, or tank states needed for validated WNTR/EPANET input. WNTR is not installed in the available API environment. The fallback below is independent deterministic code and is clearly labelled `simplified_deterministic_not_engineering_grade`.

## Equations, units and validity

At each unknown-head node, nodal continuity is solved as `Σ(H_i-H_j)/R_ij = -D_i`, with `H` in kPa gauge, `R` in kPa/(m³/h), and withdrawals `D` in m³/h. Link flow is `(H_from-H_to)/R`. A bounded Gaussian elimination with partial pivoting solves the linear system. Each solved scenario must have a maximum non-source continuity residual no greater than `1e-9 m³/h`; singular, disconnected, nonfinite, invalid-resistance, invalid-head and invalid-demand networks are rejected.

The fixture runs a steady state 60 times at a 60-second timestep across a one-hour synthetic horizon. It has no dynamic state: timestep repetition only supports a reproducible energy/downtime proxy. The energy proxy treats fixed-head pressure as pump lift from 0 kPa suction and assumes 0.70 efficiency: source head × injected flow / 3600 / efficiency, integrated across the hour. Downtime proxy is 1 hour if service pressure drops below 200 kPa or demand exceeds 6 m³/h. There are no pump curves, tank levels, Darcy-Weisbach/Hazen-Williams loss model, transient surge, elevation changes, water quality, empirical calibration or engineering-grade uncertainty estimates.

## Demonstration variants (seed 20261115)

All variants share the exact input snapshot hash and seed:

| Variant | Consumer pressure | Energy proxy | Downtime proxy | Continuity residual |
|---|---:|---:|---:|---:|
| Baseline | 250 kPa | 0.714285714 kWh | 0 h | 6.22e-15 m³/h |
| Virtual backup source | 300 kPa | 0.734126984 kWh | 0 h | 1.15e-14 m³/h |
| 1.5× synthetic service resistance | 190 kPa | 0.714285714 kWh | 1 h | 2.66e-15 m³/h |

These values are analytical outputs of this small fixture only. They are not predictions about real plant assets.

## Scenario and approval API

- `POST /v1/simulations/scenarios` saves a tenant/site-authorized immutable queued input snapshot using an idempotency key.
- `POST /v1/simulations/scenarios/{id}/execute` runs baseline plus both variants, only if the source world topology digest is still current.
- `GET /v1/simulations/scenarios` and `GET /v1/simulations/scenarios/{id}` read authorized state; `POST .../{id}/cancel` cancels queued work; `POST .../{id}/replay` recomputes the exact saved input and compares output hashes.
- `POST .../{id}/approvals` proposes one typed intervention. Approval binds its exact JSON hash and snapshot hash. A distinct owner/admin approves. The original requester applies once through `solve(...)`; response and audit clearly say `simulator_only`. There is no actuator integration.

The existing `/v1/simulations` particle-body contract is preserved unchanged because it cannot describe this hydraulic snapshot. The new Pydantic request types are exposed by runtime OpenAPI; no historical shared v1.3 schema was edited.
