from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.vacancies_service import VacancyService
from backend.etl.vacancies import REFRESH_INTERVAL_HOURS, iter_vacancies

client = TestClient(app)

SAMPLE_CSV = "\n".join(
    [
        "id;profession;employer;region;latitude;longitude;salary_from;salary_to;currency",
        "vac-1;Python-разработчик;ООО Тест;Москва;55.75;37.61;180000;220000;RUB",
        "vac-2;Водитель;МУП Парк;Казань;55.79;49.10;70000;90000;RUB",
        "vac-3;Python-разработчик;АО Софт;Казань;55.80;49.12;150000;200000;RUB",
    ]
)


def test_iter_vacancies_streams_rows_and_maps_header() -> None:
    vacancies = list(iter_vacancies(SAMPLE_CSV.splitlines()))

    assert len(vacancies) == 3
    assert vacancies[0].profession == "Python-разработчик"
    assert vacancies[0].region == "Москва"
    assert vacancies[0].has_point


def test_iter_vacancies_filters_by_profession_and_limit() -> None:
    python_only = list(iter_vacancies(SAMPLE_CSV.splitlines(), profession="python", limit=1))

    assert len(python_only) == 1
    assert python_only[0].profession == "Python-разработчик"


def test_demo_service_builds_geojson_and_top_professions(tmp_path) -> None:
    csv_path = tmp_path / "vacancies.csv"
    csv_path.write_text(SAMPLE_CSV, encoding="utf-8")
    service = VacancyService(csv_path)

    collection = service.geojson()
    assert collection["type"] == "FeatureCollection"
    assert len(collection["features"]) == 3
    assert collection["features"][0]["geometry"]["type"] == "Point"

    top = service.top_professions(limit=5)
    assert top[0] == {"profession": "Python-разработчик", "count": 2}

    filtered = service.geojson(profession="водитель")
    assert len(filtered["features"]) == 1


def test_vacancies_endpoint_returns_points() -> None:
    response = client.get("/api/v1/vacancies")

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0
    props = body["features"][0]["properties"]
    assert "profession" in props and "employer" in props


def test_vacancies_profession_filter_endpoint() -> None:
    response = client.get("/api/v1/vacancies", params={"profession": "Python-разработчик"})

    assert response.status_code == 200
    professions = {feature["properties"]["profession"] for feature in response.json()["features"]}
    assert professions == {"Python-разработчик"}


def test_top_professions_endpoint_sorted_desc() -> None:
    response = client.get("/api/v1/vacancies/professions")

    assert response.status_code == 200
    counts = [row["count"] for row in response.json()]
    assert counts == sorted(counts, reverse=True)


def test_vacancies_meta_reports_refresh_interval() -> None:
    response = client.get("/api/v1/vacancies/meta")

    assert response.status_code == 200
    meta = response.json()
    assert meta["refresh_interval_hours"] == REFRESH_INTERVAL_HOURS == 36
    assert meta["incremental_param"] == "modifiedFrom"
    assert "vacancy.csv" in meta["source_csv_url"]
