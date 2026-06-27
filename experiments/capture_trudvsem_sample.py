"""Снять реальный срез первых вакансий из открытого API «Работа России».

Issue #21: демо должно показывать настоящие вакансии из открытого API
(http://opendata.trudvsem.ru/api/v1/vacancies), а не сгенерированные строки.
Этот снимок используется как офлайн-фолбэк (когда сеть недоступна) и как
данные для тестов. Запуск:

    python experiments/capture_trudvsem_sample.py --limit 100
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

API_URL = "https://opendata.trudvsem.ru/api/v1/vacancies"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "demo" / "vacancies-sample.json"

def trim(vacancy: dict) -> dict:
    """Оставить только поля, нужные слою карты — снимок держим компактным."""

    addr = (vacancy.get("addresses") or {}).get("address") or []
    first = addr[0] if addr else {}
    address = (
        [{"lat": first.get("lat"), "lng": first.get("lng"), "location": first.get("location")}]
        if first
        else []
    )
    return {
        "id": vacancy.get("id"),
        "job-name": vacancy.get("job-name"),
        "company": {"name": (vacancy.get("company") or {}).get("name")},
        "region": {"name": (vacancy.get("region") or {}).get("name")},
        "salary_min": vacancy.get("salary_min"),
        "salary_max": vacancy.get("salary_max"),
        "currency": vacancy.get("currency") or "RUB",
        "vac_url": vacancy.get("vac_url"),
        "date_modify": vacancy.get("date_modify"),
        "creation-date": vacancy.get("creation-date"),
        "addresses": {"address": address},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    url = f"{API_URL}?offset=0&limit={args.limit}"
    user_agent = "digital-twin-demo (link.assistant.team@proton.me)"
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        payload = json.load(response)

    total = int(payload["meta"]["total"])
    raw = [item["vacancy"] for item in payload["results"]["vacancies"]]
    vacancies = [trim(v) for v in raw]
    snapshot = {
        "source": "https://opendata.trudvsem.ru/api/v1/vacancies",
        "captured_total": total,
        "vacancies": vacancies,
    }
    OUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Saved {len(vacancies)} vacancies (live total {total}) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
