from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_health_reports_version_0_1_3() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.3", "contour": "open"}


def test_roles_include_guest_without_login_and_writable_accounts() -> None:
    response = client.get("/api/v1/auth/roles")

    assert response.status_code == 200
    roles = {role["role"]: role for role in response.json()}

    assert roles["guest"]["requires_login"] is False
    assert roles["guest"]["can_write"] is False
    assert roles["operator"]["requires_login"] is True
    assert roles["operator"]["can_write"] is True
    assert roles["operator"]["display_name"] == "Оператор платформы"


def test_login_succeeds_for_operator_and_grants_write() -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "operator", "password": "operator2026"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "operator"
    assert body["can_write"] is True
    assert body["username"] == "operator"


def test_login_rejects_wrong_password_and_points_to_guest_mode() -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "operator", "password": "wrong"},
    )

    assert response.status_code == 401
    assert "гост" in response.json()["detail"].lower()


def test_objects_endpoint_lists_open_contour_objects_with_provenance() -> None:
    response = client.get("/api/v1/objects")

    assert response.status_code == 200
    objects = response.json()
    assert objects
    first = objects[0]
    assert first["provenance"]["source"]
    assert first["geometry"]["type"]
    assert {item["contour"] for item in objects} == {"open"}


def test_objects_endpoint_filters_by_layer() -> None:
    everything = client.get("/api/v1/objects").json()
    layer_id = everything[0]["layer_id"]

    filtered = client.get("/api/v1/objects", params={"layer_id": layer_id}).json()

    assert filtered
    assert {item["layer_id"] for item in filtered} == {layer_id}
