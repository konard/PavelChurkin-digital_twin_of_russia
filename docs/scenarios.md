# Demo Scenarios

The v0.1 seed includes five open-contour scenarios:

| ID                      | Source requirement                                       |
| ----------------------- | -------------------------------------------------------- |
| `regional-passport`     | OSM, Rosstat, EMISS/Fedstat, FNS                         |
| `workforce-deficit`     | Работы России exports/API, Rosstat, Minpros, Minobrnauki |
| `site-comparison`       | OSM, Rosstat, workforce data, climate and FIRMS          |
| `emergency-risk`        | Roshydromet, NASA FIRMS and OSM                          |
| `relocation-calculator` | Rosstat, OSM, climate and GAR/FIAS                       |

Guest users can inspect precomputed demo runs. Registered roles can create new
runs through `POST /api/v1/scenarios/{id}/run`. Each run records:

- `dataset_version`;
- `model_version`;
- `scenario_version`;
- result payload with source blocks;
- audit entry for the run action.
