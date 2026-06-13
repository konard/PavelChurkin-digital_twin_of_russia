from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app, store

client = TestClient(app)


def test_catalog_contains_open_data_passports_with_provenance() -> None:
    response = client.get("/api/v1/catalog/datasets")

    assert response.status_code == 200
    datasets = response.json()
    assert len(datasets) == 14
    assert {dataset["contour"] for dataset in datasets} == {"open"}

    first = datasets[0]
    assert first["source"]
    assert first["source_version"]
    assert first["license"]
    assert first["quality_flag"] in {"verified", "aggregated", "draft", "outdated"}
    assert first["known_limitations"]
    assert first["k_anonymity"] >= 5


def test_scenarios_include_required_demo_set() -> None:
    response = client.get("/api/v1/scenarios")

    assert response.status_code == 200
    scenario_ids = {scenario["id"] for scenario in response.json()}
    assert {
        "regional-passport",
        "workforce-deficit",
        "site-comparison",
        "emergency-risk",
        "relocation-calculator",
    }.issubset(scenario_ids)


def test_guest_mode_is_read_only_for_scenario_runs_and_api_keys() -> None:
    run_response = client.post(
        "/api/v1/scenarios/regional-passport/run",
        json={"region": "Москва", "parameters": {}},
    )
    key_response = client.post("/api/v1/auth/keys", json={"name": "demo"})

    assert run_response.status_code == 403
    assert "только для чтения" in run_response.json()["detail"]
    assert key_response.status_code == 403


def test_registered_run_records_versions_provenance_and_audit() -> None:
    response = client.post(
        "/api/v1/scenarios/workforce-deficit/run",
        headers={"X-Role": "citizen", "X-Actor": "analyst@example.test"},
        json={"region": "Москва", "parameters": {"profession": "Software developer"}},
    )

    assert response.status_code == 200
    run = response.json()
    assert run["dataset_version"]
    assert run["model_version"] == "labor-gap-model-v0.1"
    assert run["scenario_version"] == "scenario-5.1-v0.1"
    assert run["result"]["sources"]
    assert store.audit_log.verify_chain()


def test_markdown_export_contains_source_block_and_versions() -> None:
    response = client.get(
        "/api/v1/runs/demo-regional-passport/export?format=md",
        headers={"X-Role": "guest", "X-Actor": "visitor"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    body = response.text
    assert "Источники и ограничения" in body
    assert "Версия датасета" in body
    assert "ограничение:" in body
    assert "Данный отчёт намеренно неполный" in body


def test_audit_hash_chain_verification_endpoint() -> None:
    response = client.get("/api/v1/audit/verify")

    assert response.status_code == 200
    assert response.json() == {"valid": True}
