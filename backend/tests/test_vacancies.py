from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.vacancies_service import (
    GUEST_LIMIT,
    MAX_LIMIT,
    VacancyService,
    offline_vacancy_service,
)
from backend.etl.vacancies import (
    REFRESH_INTERVAL_HOURS,
    fetch_api_page,
    fetch_api_vacancies,
    iter_vacancies,
    load_sample_vacancies,
    parse_api_response,
    stream_remote_lines,
    vacancy_from_api,
)

client = TestClient(app)

SAMPLE_CSV = "\n".join(
    [
        "id;profession;employer;region;latitude;longitude;salary_from;salary_to;currency",
        "vac-1;Python-разработчик;ООО Тест;Москва;55.75;37.61;180000;220000;RUB",
        "vac-2;Водитель;МУП Парк;Казань;55.79;49.10;70000;90000;RUB",
        "vac-3;Python-разработчик;АО Софт;Казань;55.80;49.12;150000;200000;RUB",
    ]
)


def _api_vacancy(identifier: str, job: str, lat: str, lng: str) -> dict:
    return {
        "id": identifier,
        "job-name": job,
        "company": {"name": "ООО Тест"},
        "region": {"name": "Москва"},
        "salary_min": 100000,
        "salary_max": 150000,
        "currency": "RUB",
        "vac_url": f"https://trudvsem.ru/vacancy/{identifier}",
        "date_modify": "2026-06-26",
        "addresses": {"address": [{"lat": lat, "lng": lng, "location": "Москва"}]},
    }


def _api_payload(vacancies: list[dict], total: int) -> dict:
    return {
        "status": "200",
        "meta": {"total": total, "limit": len(vacancies)},
        "results": {"vacancies": [{"vacancy": v} for v in vacancies]},
    }


# --- CSV-разбор (issue #12/#17) ---------------------------------------------


def test_iter_vacancies_streams_rows_and_maps_header() -> None:
    vacancies = list(iter_vacancies(SAMPLE_CSV.splitlines()))

    assert len(vacancies) == 3
    assert vacancies[0].profession == "Python-разработчик"
    assert vacancies[0].region == "Москва"
    assert vacancies[0].has_point


def test_stream_remote_lines_decodes_windows_1251() -> None:
    payload = "id;profession\nvac-1;Инженер-строитель\n".encode("cp1251")

    def fake_opener(_request: object) -> io.BytesIO:
        return io.BytesIO(payload)

    lines = list(
        stream_remote_lines("https://example.test/v.csv", opener=fake_opener, encoding="cp1251")
    )
    assert lines[0].startswith("id;profession")
    assert "Инженер-строитель" in "".join(lines)


# --- Открытый JSON API «Работа России» (issue #21) --------------------------


def test_vacancy_from_api_extracts_coordinates_and_fields() -> None:
    vacancy = vacancy_from_api(_api_vacancy("a1", "Сварщик", "55.75", "37.61"))

    assert vacancy is not None
    assert vacancy.id == "a1"
    assert vacancy.profession == "Сварщик"
    assert vacancy.employer == "ООО Тест"
    assert vacancy.has_point
    assert vacancy.lat == 55.75 and vacancy.lon == 37.61
    assert vacancy.url.endswith("a1")


def test_vacancy_from_api_skips_records_without_id() -> None:
    assert vacancy_from_api({"job-name": "Без id"}) is None


def test_parse_api_response_returns_total_and_vacancies() -> None:
    payload = _api_payload([_api_vacancy("a1", "X", "55", "37")], total=548340)

    vacancies, total = parse_api_response(payload)

    assert total == 548340
    assert len(vacancies) == 1


def test_fetch_api_page_uses_injected_opener() -> None:
    payload = _api_payload([_api_vacancy("a1", "X", "55", "37")], total=42)

    def fake_opener(_request: object, timeout: float = 30.0) -> io.BytesIO:
        return io.BytesIO(json.dumps(payload).encode("utf-8"))

    vacancies, total = fetch_api_page(0, 5, opener=fake_opener)

    assert total == 42
    assert len(vacancies) == 1


def test_fetch_api_vacancies_pages_until_target_with_delay() -> None:
    pool = [_api_vacancy(f"v{i}", "Профессия", "55", "37") for i in range(250)]
    calls: list[tuple[int, int]] = []
    delays: list[float] = []

    def fake_opener(request: object, timeout: float = 30.0) -> io.BytesIO:
        import urllib.parse as up

        query = dict(up.parse_qsl(up.urlparse(request.full_url).query))  # type: ignore[attr-defined]
        offset, limit = int(query["offset"]), int(query["limit"])
        calls.append((offset, limit))
        page = pool[offset : offset + limit]
        return io.BytesIO(json.dumps(_api_payload(page, total=len(pool))).encode("utf-8"))

    vacancies, total = fetch_api_vacancies(220, opener=fake_opener, sleep=delays.append, delay=0.21)

    assert len(vacancies) == 220
    assert total == 250
    # 100 + 100 + 20 = 220 → три страницы, две паузы между ними.
    assert calls == [(0, 100), (100, 100), (200, 20)]
    assert delays == [0.21, 0.21]


def test_load_sample_vacancies_reads_repo_snapshot() -> None:
    vacancies, total = load_sample_vacancies()

    assert len(vacancies) > 0
    # captured_total — полное число вакансий в источнике на момент снимка.
    assert total >= len(vacancies)
    assert any(v.has_point for v in vacancies)


# --- Сервис слоя вакансий ----------------------------------------------------


def test_service_loads_requested_count_from_injected_fetcher() -> None:
    pool = [vacancy_from_api(_api_vacancy(f"v{i}", "Тест", "55", "37")) for i in range(10)]

    def fetcher(count: int) -> tuple[list, int]:
        return [v for v in pool[:count] if v is not None], 1000

    service = VacancyService(fetcher=fetcher)
    collection = service.geojson(count=3)

    assert collection["type"] == "FeatureCollection"
    assert collection["loaded"] == 3
    assert collection["returned"] == 3
    assert collection["total"] == 1000


def test_service_falls_back_to_sample_when_fetcher_fails() -> None:
    def failing_fetcher(_count: int) -> tuple[list, int]:
        raise RuntimeError("network down")

    service = VacancyService(fetcher=failing_fetcher)
    collection = service.geojson(count=50)

    # Сеть недоступна — данные берутся из офлайн-среза, слой не пустой.
    assert collection["returned"] > 0
    assert collection["total"] > 0


def test_service_source_total_reports_live_number() -> None:
    def fetcher(count: int) -> tuple[list, int]:
        return [], 548340

    service = VacancyService(fetcher=fetcher)
    # Даже при пустой странице total читается из meta источника (фолбэк-срез
    # докинет вакансии, но число всех вакансий — живое).
    assert service.source_total() == 548340


def test_offline_service_filters_by_profession() -> None:
    service = offline_vacancy_service()
    vacancies, _ = service._load(GUEST_LIMIT)
    target = vacancies[0].profession

    filtered = service.geojson(profession=target, count=GUEST_LIMIT)
    professions = {f["properties"]["profession"] for f in filtered["features"]}
    assert professions == {target}


# --- HTTP-эндпоинты ----------------------------------------------------------


def test_vacancies_endpoint_returns_points() -> None:
    response = client.get("/api/v1/vacancies")

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0
    props = body["features"][0]["properties"]
    assert "profession" in props and "employer" in props


def test_guest_is_capped_to_one_api_page() -> None:
    # Гость получает ровно одну страницу API (issue #21: один запрос).
    body = client.get("/api/v1/vacancies", params={"count": MAX_LIMIT}).json()
    assert body["loaded"] <= GUEST_LIMIT


def test_authenticated_role_can_request_custom_count() -> None:
    body = client.get(
        "/api/v1/vacancies",
        params={"count": 5},
        headers={"X-Role": "operator"},
    ).json()
    assert body["loaded"] == 5


def test_vacancies_endpoint_rejects_huge_count() -> None:
    response = client.get("/api/v1/vacancies", params={"count": MAX_LIMIT + 1})

    assert response.status_code == 422


def test_vacancies_profession_filter_endpoint() -> None:
    professions = client.get("/api/v1/vacancies/professions").json()
    target = professions[0]["profession"]

    response = client.get("/api/v1/vacancies", params={"profession": target})
    assert response.status_code == 200
    shown = {feature["properties"]["profession"] for feature in response.json()["features"]}
    assert shown == {target}


def test_top_professions_endpoint_sorted_desc() -> None:
    response = client.get("/api/v1/vacancies/professions")

    assert response.status_code == 200
    counts = [row["count"] for row in response.json()]
    assert counts == sorted(counts, reverse=True)


def test_vacancies_meta_reports_source_and_limits() -> None:
    response = client.get("/api/v1/vacancies/meta")

    assert response.status_code == 200
    meta = response.json()
    assert meta["refresh_interval_hours"] == REFRESH_INTERVAL_HOURS == 36
    assert meta["guest_limit"] == GUEST_LIMIT
    assert "api/v1/vacancies" in meta["source_api_url"]
    assert meta["total"] >= meta["guest_limit"]


def test_config_endpoint_reports_yandex_state(monkeypatch) -> None:
    monkeypatch.delenv("YANDEX_API_KEY", raising=False)
    monkeypatch.delenv("VITE_YANDEX_API_KEY", raising=False)
    disabled = client.get("/api/v1/config").json()
    assert disabled["yandex_enabled"] is False
    assert disabled["yandex_api_key"] == ""

    monkeypatch.setenv("YANDEX_API_KEY", "demo-key")
    enabled = client.get("/api/v1/config").json()
    assert enabled["yandex_enabled"] is True
    assert enabled["yandex_api_key"] == "demo-key"
