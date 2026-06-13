# Architecture

The v0.1 implementation is a narrow open-contour demonstrator:

```text
Open CSV/file/API source descriptors
  -> ETL scaffold and dataset passports
  -> Seeded catalog and layer/object records
  -> FastAPI read API and deterministic scenario engine
  -> React + MapLibre dashboard and report view
  -> Audit log with hash-chain verification
```

## Backend Services

| Spec ID            | Implementation                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| S1 Auth/RBAC       | Header-based role scaffold: guest, citizen, business, developer, operator |
| S2 Catalog         | Dataset passport endpoints and filters                                    |
| S3 Scenario engine | Deterministic open-data demo runs with fixed versions                     |
| S4 Geoservice      | Layer/object endpoints and GeoJSON tile envelope                          |
| S5 Export          | Markdown and minimal PDF report exports                                   |
| S6 Audit           | Append-only in-memory hash chain                                          |
| S7 Gateway         | Open-contour and k-anonymity checks for public datasets                   |

The API is intentionally seeded from `data/demo` so tests are reproducible and
do not rely on live Russian open-data endpoints.

## Frontend Modules

| Spec ID          | Implementation                                        |
| ---------------- | ----------------------------------------------------- |
| M1 Map           | MapLibre panel with local GeoJSON pilot-region layers |
| M2 Scenarios     | Demo scenario catalog                                 |
| M3 Catalog       | Dataset passport table with quality badges            |
| M4 Reports       | Precomputed report summary and version block          |
| M5 Cabinet/Roles | Role model is represented in API write restrictions   |
| M6 Admin         | Deferred after operator workflow is defined           |
| M7 Audit         | API endpoint verifies the hash chain                  |

## Data Boundaries

Only `contour=open` records are returned. The demo excludes personal data,
critical-infrastructure schemes and closed-contour scenarios. Dataset records
with aggregated or anonymized PII status must satisfy `k_anonymity >= 5`.
