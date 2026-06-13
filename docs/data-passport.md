# Dataset Passport Contract

Each open-contour dataset is represented by a passport in
`data/demo/datasets.json`.

Required fields:

| Field                   | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `id`                    | Stable dataset identifier                             |
| `title`                 | Human-readable title                                  |
| `domain`                | Data domain for filtering                             |
| `region`                | Pilot region or national scope                        |
| `owner`                 | Data owner or steward                                 |
| `source` / `source_url` | Origin and access point                               |
| `source_version`        | Export or snapshot date                               |
| `license`               | Publication or reuse terms                            |
| `update_frequency`      | Expected refresh cadence                              |
| `classifier_alignment`  | OKTMO/OKVED/OKZ/OKSO/WGS-84 alignment                 |
| `pii_status`            | `none`, `aggregated`, `anonymized` or `pseudonymized` |
| `k_anonymity`           | Public-contour aggregation guard                      |
| `known_limitations`     | Explicit caveats shown in reports                     |
| `validators`            | Checks applied by ETL or review                       |
| `quality_flag`          | `verified`, `aggregated`, `draft` or `outdated`       |
| `contour`               | Must be `open` in v0.1                                |

Scenario runs and exports include the source/version/license/quality fields
from these passports so reviewers can trace every metric back to the seed
catalog.
