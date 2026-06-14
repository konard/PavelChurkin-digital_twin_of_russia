from __future__ import annotations

import json

from backend.etl.geocoding import USER_AGENT, NominatimGeocoder, QuotaGuard


def test_nominatim_sets_contact_user_agent_and_parses_result() -> None:
    captured: dict[str, dict[str, str]] = {}

    def fake_fetch(url: str, headers: dict[str, str]) -> str:
        captured["headers"] = headers
        captured["url"] = url  # type: ignore[assignment]
        return json.dumps([{"lat": "55.75", "lon": "37.61", "display_name": "Москва"}])

    geocoder = NominatimGeocoder(fetch=fake_fetch, sleeper=lambda _: None, clock=lambda: 0.0)
    result = geocoder.geocode("Москва")

    assert result is not None
    assert (round(result.lat, 2), round(result.lon, 2)) == (55.75, 37.61)
    assert captured["headers"]["User-Agent"] == USER_AGENT
    assert "paxanch94@inbox.ru" in USER_AGENT


def test_nominatim_throttles_to_one_request_per_second() -> None:
    waits: list[float] = []
    now = {"value": 0.0}

    def fake_fetch(url: str, headers: dict[str, str]) -> str:
        return json.dumps([{"lat": "0", "lon": "0"}])

    def fake_sleep(seconds: float) -> None:
        waits.append(seconds)
        now["value"] += seconds

    geocoder = NominatimGeocoder(fetch=fake_fetch, sleeper=fake_sleep, clock=lambda: now["value"])
    geocoder.geocode("Москва")
    # второй запрос сразу же должен подождать почти секунду
    geocoder.geocode("Казань")

    assert waits and waits[0] > 0.9


def test_quota_guard_enforces_hourly_and_daily_limits() -> None:
    now = {"value": 0.0}
    guard = QuotaGuard(max_per_hour=2, max_per_day=3, clock=lambda: now["value"])

    assert guard.record() is True
    assert guard.record() is True
    # третий за тот же час — отклонён
    assert guard.allow() is False
    assert guard.record() is False

    # спустя час счётчик часа очищается, дневной остаётся
    now["value"] = 3601
    assert guard.record() is True
    assert guard.used_last_day == 3
    # дневной лимит исчерпан
    now["value"] = 3602
    assert guard.record() is False
