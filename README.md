# Digital Twin of Russia v0.1

Open-contour prototype for the project described in
PavelChurkin/digital_twin_of_russia#1. The repository follows the referenced
SaaS implementation prompts: FastAPI backend, React/MapLibre frontend, seeded
open-data passports, scenario runs, report export, audit logging, and local
development infrastructure.

## Scope

v0.1 is a demonstrator, not a production state platform. It uses only open and
aggregated demo data:

- 12 first-queue CSV/file data sources plus 2 API connector descriptors;
- dataset passports with source, version, license, quality and limitations;
- open-contour read APIs for catalog, layers, objects, scenarios and reports;
- deterministic demo scenario runs for regional passport, workforce deficit,
  site comparison, emergency risk and relocation comparison;
- read-only guest mode, write actions for registered roles, API keys for
  developer/operator roles;
- append-only audit log with hash-chain verification.

No personal data, critical-infrastructure schemes, closed-contour data or
automatic management decisions are exposed.

## Repository Layout

```text
backend/              FastAPI app, ETL scaffold, scenario engine, tests, Alembic
frontend/             Vite + React + TypeScript + MapLibre app
infra/                Docker Compose and Airflow DAG scaffold
data/demo/            Seeded open-contour datasets, layers, objects, scenarios
data/classifiers/     Starter classifier seed
docs/                 Architecture and v0.1 implementation notes
.github/workflows/    Pull-request CI
```

## Local Development

Install and test everything:

```bash
make install
make lint
make test
```

Run the API and frontend in separate terminals:

```bash
make dev-backend
make dev-frontend
```

Open the app at `http://localhost:5173`; the API is at
`http://localhost:8000`, and OpenAPI docs are at `http://localhost:8000/docs`.

Seed summary:

```bash
make seed-open-data
```

Docker stack:

```bash
make up
make down
```

The compose stack includes PostgreSQL/PostGIS, Redis, MinIO, Airflow, backend
and frontend services. The current API uses seeded JSON data so the repository
can be tested without live external data downloads.

## API Surface

- `GET /api/v1/catalog/datasets`
- `GET /api/v1/catalog/datasets/{id}`
- `GET /api/v1/layers`
- `GET /api/v1/tiles/{layer}/{z}/{x}/{y}`
- `GET /api/v1/objects/{id}`
- `GET /api/v1/scenarios`
- `POST /api/v1/scenarios/{id}/run`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/export?format=md|pdf`
- `POST /api/v1/auth/keys`
- `GET /api/v1/audit/verify`

Every data-bearing response carries provenance directly or through its dataset
passport: source, source version, license, quality flag and known limitations.

## Verification

Backend tests pin the v0.1 contracts:

- catalog contains 14 open-contour passports;
- guest mode blocks write actions;
- scenario runs record dataset/model/scenario versions;
- Markdown exports include provenance and limitations;
- audit hash-chain verification stays valid;
- ETL parses Windows-1251 CSV and builds passports.

Frontend CI runs ESLint, Prettier check, TypeScript build and Vite build.
