from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from backend.app.audit import AuditLog
from backend.app.schemas import (
    DatasetPassport,
    Layer,
    Role,
    RunRequest,
    Scenario,
    ScenarioRun,
    TwinObject,
)
from backend.models.scenario_engine import build_scenario_result

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "demo"


class DemoStore:
    def __init__(self, data_dir: Path = DEFAULT_DATA_DIR) -> None:
        self.data_dir = data_dir
        self.audit_log = AuditLog()
        self.datasets = self._load_datasets()
        self.layers = self._load_layers()
        self.objects = self._load_objects()
        self.scenarios = self._load_scenarios()
        self.runs: dict[str, ScenarioRun] = {}
        self._seed_demo_runs()

    def _read_json(self, filename: str) -> list[dict]:
        with (self.data_dir / filename).open(encoding="utf-8") as file:
            return json.load(file)

    def _load_datasets(self) -> dict[str, DatasetPassport]:
        return {
            item["id"]: DatasetPassport.model_validate(item)
            for item in self._read_json("datasets.json")
        }

    def _load_layers(self) -> dict[str, Layer]:
        layers: dict[str, Layer] = {}
        for item in self._read_json("layers.json"):
            dataset = self.datasets[item["dataset_id"]]
            layers[item["id"]] = Layer.model_validate({**item, "provenance": dataset.provenance})
        return layers

    def _load_objects(self) -> dict[str, TwinObject]:
        objects: dict[str, TwinObject] = {}
        for item in self._read_json("objects.json"):
            layer = self.layers[item["layer_id"]]
            objects[item["id"]] = TwinObject.model_validate(
                {**item, "provenance": layer.provenance}
            )
        return objects

    def _load_scenarios(self) -> dict[str, Scenario]:
        return {
            item["id"]: Scenario.model_validate(item) for item in self._read_json("scenarios.json")
        }

    def _seed_demo_runs(self) -> None:
        for scenario in self.scenarios.values():
            request = RunRequest(region="Москва", parameters={})
            run = self.create_run(
                scenario.id,
                request,
                actor="demo",
                role="operator",
                run_id=f"demo-{scenario.id}",
                audit=False,
            )
            self.runs[run.id] = run

    def list_datasets(
        self,
        *,
        domain: str | None = None,
        region: str | None = None,
        quality_flag: str | None = None,
    ) -> list[DatasetPassport]:
        datasets = list(self.datasets.values())
        if domain:
            datasets = [dataset for dataset in datasets if dataset.domain == domain]
        if region:
            datasets = [dataset for dataset in datasets if dataset.region in {region, "Россия"}]
        if quality_flag:
            datasets = [dataset for dataset in datasets if dataset.quality_flag == quality_flag]
        return sorted(datasets, key=lambda dataset: dataset.id)

    def list_layers(self, *, domain: str | None = None, region: str | None = None) -> list[Layer]:
        layers = list(self.layers.values())
        if domain:
            layers = [layer for layer in layers if layer.domain == domain]
        if region:
            layers = [layer for layer in layers if layer.region in {region, "Россия"}]
        return sorted(layers, key=lambda layer: layer.id)

    def scenario_datasets(self, scenario: Scenario) -> list[DatasetPassport]:
        return [self.datasets[dataset_id] for dataset_id in scenario.data_requirements]

    def dataset_version_for(self, scenario: Scenario) -> str:
        versions = [
            f"{dataset.id}@{dataset.source_version.isoformat()}"
            for dataset in self.scenario_datasets(scenario)
        ]
        return ";".join(versions)

    def create_run(
        self,
        scenario_id: str,
        request: RunRequest,
        *,
        actor: str,
        role: Role,
        run_id: str | None = None,
        audit: bool = True,
    ) -> ScenarioRun:
        scenario = self.scenarios[scenario_id]
        datasets = self.scenario_datasets(scenario)
        result = build_scenario_result(
            scenario,
            region=request.region,
            parameters=request.parameters,
            datasets=datasets,
        )
        run = ScenarioRun(
            id=run_id or f"run-{uuid4().hex[:12]}",
            scenario_id=scenario.id,
            requested_by=actor,
            role=role,
            parameters={"region": request.region, **request.parameters},
            dataset_version=self.dataset_version_for(scenario),
            model_version=scenario.model_version,
            scenario_version=scenario.version,
            result=result,
            created_at=datetime.now(UTC),
        )
        self.runs[run.id] = run
        if audit:
            self.audit_log.append(
                actor=actor,
                role=role,
                action="scenario.run",
                contour=scenario.contour,
                target_id=run.id,
                data_versions={
                    "dataset_version": run.dataset_version,
                    "model_version": run.model_version,
                    "scenario_version": run.scenario_version,
                },
            )
        return run
