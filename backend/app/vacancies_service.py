"""Сервис слоя вакансий для API открытого контура.

Загружает демонстрационную выгрузку «Работа России», отдаёт её как GeoJSON
для кластеризации и тепловой карты на фронтенде, строит топ профессий и
метаданные слоя (источник, периодичность обновления раз в 1.5 дня).
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from backend.etl.vacancies import (
    DEMO_VACANCIES_CSV,
    REFRESH_INTERVAL_HOURS,
    TRUDVSEM_CSV_URL,
    Vacancy,
    iter_vacancies,
    load_demo_vacancies,
)


def _money(amount: float) -> str:
    return f"{int(amount):,}".replace(",", " ")


def _format_salary(vacancy: Vacancy) -> str | None:
    if vacancy.salary_from and vacancy.salary_to:
        return f"{_money(vacancy.salary_from)}–{_money(vacancy.salary_to)} {vacancy.currency}"
    if vacancy.salary_from:
        return f"от {_money(vacancy.salary_from)} {vacancy.currency}"
    if vacancy.salary_to:
        return f"до {_money(vacancy.salary_to)} {vacancy.currency}"
    return None


class VacancyService:
    def __init__(self, csv_path: Path = DEMO_VACANCIES_CSV) -> None:
        self.csv_path = csv_path
        self.vacancies: list[Vacancy] = load_demo_vacancies(csv_path)

    def _filter(self, profession: str | None) -> list[Vacancy]:
        if not profession:
            return self.vacancies
        needle = profession.strip().lower()
        return [v for v in self.vacancies if needle in v.profession.lower()]

    @staticmethod
    def _feature(vacancy: Vacancy) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [vacancy.lon, vacancy.lat],
            },
            "properties": {
                "id": vacancy.id,
                "profession": vacancy.profession,
                "employer": vacancy.employer,
                "region": vacancy.region,
                "salary": _format_salary(vacancy),
                "url": vacancy.url,
            },
        }

    def geojson(
        self,
        *,
        profession: str | None = None,
        offset: int = 0,
        limit: int | None = None,
    ) -> dict:
        """Слой вакансий как GeoJSON с постраничной (инкрементальной) отдачей.

        ``offset``/``limit`` позволяют фронтенду догружать вакансии порциями
        (issue #17: непрерывная подгрузка по мере появления данных), а поле
        ``total`` сообщает полный объём текущего среза, чтобы клиент знал,
        сколько ещё страниц осталось.
        """

        points = [v for v in self._filter(profession) if v.has_point]
        total = len(points)
        start = max(offset, 0)
        page = points[start:] if limit is None else points[start : start + limit]
        features = [self._feature(vacancy) for vacancy in page]
        return {
            "type": "FeatureCollection",
            "features": features,
            "total": total,
            "offset": start,
            "returned": len(features),
        }

    def top_professions(self, *, limit: int = 12) -> list[dict]:
        counter: Counter[str] = Counter(v.profession for v in self.vacancies)
        return [
            {"profession": profession, "count": count}
            for profession, count in counter.most_common(limit)
        ]

    def meta(self) -> dict:
        return {
            "source": "Работа России / «Труд всем»",
            "source_csv_url": TRUDVSEM_CSV_URL,
            "dataset_id": "trudvsem-opendata",
            "total": len(self.vacancies),
            "professions": len({v.profession for v in self.vacancies}),
            "regions": len({v.region for v in self.vacancies}),
            "refresh_interval_hours": REFRESH_INTERVAL_HOURS,
            "incremental_param": "modifiedFrom",
            "geocoder": "Nominatim (≤1 запрос/сек)",
            "note": (
                "Демо-выгрузка. Живой источник — потоковое чтение vacancy.csv "
                "без сохранения на диск."
            ),
        }


def vacancies_csv_text(csv_path: Path = DEMO_VACANCIES_CSV) -> str:
    """Сырой CSV вакансий для выгрузки оператором (как есть)."""

    return csv_path.read_text(encoding="utf-8")


def iter_vacancies_from_text(text: str) -> list[Vacancy]:
    """Утилита для тестов: разобрать CSV из строки потоково."""

    return list(iter_vacancies(text.splitlines()))
