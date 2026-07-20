"""Сервис слоя вакансий для API открытого контура.

Issue #21: демо больше не использует сгенерированные вакансии. Слой питается
из открытого REST API «Работа России»
(``https://opendata.trudvsem.ru/api/v1/vacancies``):

* гостю отдаётся одна страница API (100 вакансий) — один запрос;
* авторизованным ролям показывается полное число вакансий в источнике, и они
  могут указать, сколько вакансий подгрузить (постранично, с паузой 0.21 с);
* если сеть недоступна, сервис прозрачно падает на офлайн-срез реальных
  вакансий (``data/demo/vacancies-sample.json``), снятый с того же API.
"""

from __future__ import annotations

import csv
import io
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from backend.etl.vacancies import (
    API_PAGE_LIMIT,
    DEMO_VACANCIES_SAMPLE,
    REFRESH_INTERVAL_HOURS,
    TRUDVSEM_API_URL,
    TRUDVSEM_CSV_URL,
    Vacancy,
    fetch_api_page,
    fetch_api_vacancies,
    load_sample_vacancies,
)

# Гостю — одна страница открытого API (issue #21: «один запрос апи для гостя»).
GUEST_LIMIT = API_PAGE_LIMIT
# Сколько вакансий грузим по умолчанию, если число не указано.
DEFAULT_LIMIT = API_PAGE_LIMIT
# Предохранитель на массовую загрузку авторизованными ролями, чтобы не
# простаивать на тысячах последовательных запросов к источнику.
MAX_LIMIT = 5000

# Инъектируемый загрузчик: ``count -> (вакансии, всего)``. По умолчанию —
# живой API; в тестах подменяется офлайн-функцией.
VacancyFetcher = Callable[[int], tuple[list[Vacancy], int]]
# Постраничный загрузчик: ``(offset, limit) -> (вакансии, всего)``. Нужен для
# прогрессивной подгрузки с отображением счётчика в реальном времени (issue #23).
PageFetcher = Callable[[int, int], tuple[list[Vacancy], int]]


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


def _clamp(count: int, *, cap: int = MAX_LIMIT) -> int:
    try:
        value = int(count)
    except (TypeError, ValueError):
        value = DEFAULT_LIMIT
    return max(1, min(value, cap))


class VacancyService:
    def __init__(
        self,
        fetcher: VacancyFetcher | None = None,
        *,
        page_fetcher: PageFetcher | None = None,
        sample_path: Path = DEMO_VACANCIES_SAMPLE,
    ) -> None:
        # По умолчанию — живой API «Работа России».
        self._fetcher: VacancyFetcher = fetcher or (lambda count: fetch_api_vacancies(count))
        # Постраничный загрузчик по умолчанию тоже бьёт в живой API одной
        # страницей; в тестах/офлайне подменяется срезом снимка.
        self._page_fetcher: PageFetcher = page_fetcher or (
            lambda offset, limit: fetch_api_page(offset, limit)
        )
        self._sample_path = sample_path
        self._sample_cache: tuple[list[Vacancy], int] | None = None
        self._total_cache: int | None = None

    # --- источники данных ---------------------------------------------------

    def _sample(self) -> tuple[list[Vacancy], int]:
        if self._sample_cache is None:
            self._sample_cache = load_sample_vacancies(self._sample_path)
        return self._sample_cache

    def _load(self, count: int) -> tuple[list[Vacancy], int]:
        """Подгрузить до ``count`` вакансий с фолбэком на офлайн-срез."""

        count = _clamp(count)
        vacancies: list[Vacancy] = []
        total = 0
        try:
            vacancies, total = self._fetcher(count)
        except Exception:  # noqa: BLE001 — сеть недоступна → офлайн-срез
            vacancies, total = [], 0
        if not vacancies:
            sample_vacancies, sample_total = self._sample()
            vacancies = list(sample_vacancies[:count])
            total = total or sample_total
        if total:
            self._total_cache = total
        return vacancies, total

    def _load_page(self, offset: int) -> tuple[list[Vacancy], int]:
        """Подгрузить одну страницу (100 вакансий) с фолбэком на офлайн-срез.

        ``offset`` — номер страницы (0, 1, 2…). При недоступности сети берётся
        соответствующий срез снимка, чтобы прогрессивная загрузка работала и
        офлайн (issue #23).
        """

        page = max(0, int(offset))
        vacancies: list[Vacancy] = []
        total = 0
        try:
            vacancies, total = self._page_fetcher(page, API_PAGE_LIMIT)
        except Exception:  # noqa: BLE001 — сеть недоступна → офлайн-срез
            vacancies, total = [], 0
        if not vacancies:
            sample_vacancies, sample_total = self._sample()
            start = page * API_PAGE_LIMIT
            vacancies = list(sample_vacancies[start : start + API_PAGE_LIMIT])
            total = total or sample_total
        if total:
            self._total_cache = total
        return vacancies, total

    @staticmethod
    def _normalize(vacancies: list[Vacancy]) -> list[Vacancy]:
        """Отбросить непригодные вакансии и дубли (issue #23).

        * без координат — не попадают на карту («Вакансии с координатами не
          найдены»), поэтому убираются;
        * без зарплаты — бесполезны для фильтра по зарплате, тоже убираются;
        * повторы по ``id`` (постраничная выдача источника изредка дублирует
          записи) схлопываются, чтобы на карте не было задвоенных точек.
        """

        seen: set[str] = set()
        cleaned: list[Vacancy] = []
        for vacancy in vacancies:
            if not vacancy.has_point or not vacancy.has_salary:
                continue
            if vacancy.id in seen:
                continue
            seen.add(vacancy.id)
            cleaned.append(vacancy)
        return cleaned

    def source_total(self) -> int:
        """Полное число вакансий в источнике (issue #21: показать пользователю)."""

        if self._total_cache is None:
            self._load(1)
        if self._total_cache is None:
            self._total_cache = self._sample()[1]
        return self._total_cache

    # --- представление ------------------------------------------------------

    @staticmethod
    def _filter(vacancies: list[Vacancy], profession: str | None) -> list[Vacancy]:
        if not profession:
            return vacancies
        needle = profession.strip().lower()
        return [v for v in vacancies if needle in v.profession.lower()]

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
                # Город из адреса вакансии (issue #27): в отчёте города берутся
                # именно отсюда. Если город не распознан — подставляем регион,
                # чтобы у точки всегда был человекочитаемый населённый пункт.
                "city": vacancy.city or vacancy.region,
                "salary": _format_salary(vacancy),
                # Числовое значение зарплаты для клиентского фильтра по порогу
                # (issue #23): фронтенд прячет точки ниже выбранной зарплаты.
                "salary_value": vacancy.salary_value,
                "url": vacancy.url,
                # Даты создания и изменения вакансии (issue #25): нужны для
                # фильтра по дате и отчёта «Анализ вакансий Работа России».
                "created_at": vacancy.created_at,
                "modified_at": vacancy.modified_at,
            },
        }

    def geojson(
        self,
        *,
        profession: str | None = None,
        count: int = DEFAULT_LIMIT,
    ) -> dict:
        """Слой вакансий как GeoJSON.

        ``count`` — сколько вакансий подгрузить из открытого API. ``total`` —
        полное число вакансий в источнике, ``loaded`` — сколько фактически
        получено, ``returned`` — сколько из них с координатами попало на карту.
        """

        vacancies, total = self._load(count)
        cleaned = self._normalize(vacancies)
        filtered = self._filter(cleaned, profession)
        features = [self._feature(vacancy) for vacancy in filtered]
        return {
            "type": "FeatureCollection",
            "features": features,
            "total": total,
            "loaded": len(cleaned),
            "returned": len(features),
        }

    def geojson_page(
        self,
        *,
        offset: int = 0,
        profession: str | None = None,
    ) -> dict:
        """Одна страница слоя вакансий как GeoJSON (issue #23).

        Прогрессивная загрузка на фронтенде листает страницы по одной и
        показывает счётчик подгруженных вакансий в реальном времени, а также
        кэширует накопленный результат, чтобы кнопка «все» и фильтры не
        опрашивали API повторно. ``page`` — номер запрошенной страницы,
        ``page_size`` — размер страницы источника, ``exhausted`` — исчерпан ли
        источник (страница покрыла последние записи ``meta.total``).
        """

        page = max(0, int(offset))
        vacancies, total = self._load_page(page)
        cleaned = self._normalize(vacancies)
        filtered = self._filter(cleaned, profession)
        features = [self._feature(vacancy) for vacancy in filtered]
        consumed = (page + 1) * API_PAGE_LIMIT
        exhausted = not vacancies or (bool(total) and consumed >= total)
        return {
            "type": "FeatureCollection",
            "features": features,
            "total": total,
            "loaded": len(cleaned),
            "returned": len(features),
            "page": page,
            "page_size": API_PAGE_LIMIT,
            "exhausted": exhausted,
        }

    def top_professions(self, *, limit: int = 12, count: int = DEFAULT_LIMIT) -> list[dict]:
        vacancies, _ = self._load(count)
        counter: Counter[str] = Counter(v.profession for v in vacancies)
        return [
            {"profession": profession, "count": count}
            for profession, count in counter.most_common(limit)
        ]

    def meta(self) -> dict:
        total = self.source_total()
        return {
            "source": "Работа России / «Труд всем»",
            "source_api_url": TRUDVSEM_API_URL,
            "source_csv_url": TRUDVSEM_CSV_URL,
            "dataset_id": "trudvsem-api",
            "total": total,
            "guest_limit": GUEST_LIMIT,
            "max_limit": MAX_LIMIT,
            "page_limit": API_PAGE_LIMIT,
            "request_delay_seconds": 0.21,
            "refresh_interval_hours": REFRESH_INTERVAL_HOURS,
            "incremental_param": "modifiedFrom",
            "geocoder": "Координаты из API «Работа России» (addresses.lat/lng)",
            "note": (
                "Демо берёт первые вакансии из открытого API «Работа России». "
                "Гостю — одна страница (100 вакансий); авторизованным ролям "
                "доступна подгрузка указанного числа вакансий."
            ),
        }

    def csv_text(self, *, count: int = DEFAULT_LIMIT) -> str:
        """Сырой CSV подгруженных вакансий для выгрузки оператором."""

        vacancies, _ = self._load(count)
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")
        writer.writerow(
            [
                "id",
                "profession",
                "employer",
                "region",
                "city",
                "latitude",
                "longitude",
                "salary_from",
                "salary_to",
                "currency",
                "url",
                "created_at",
                "modified_at",
            ]
        )
        for vacancy in vacancies:
            writer.writerow(
                [
                    vacancy.id,
                    vacancy.profession,
                    vacancy.employer,
                    vacancy.region,
                    vacancy.city or vacancy.region,
                    "" if vacancy.lat is None else f"{vacancy.lat:.6f}",
                    "" if vacancy.lon is None else f"{vacancy.lon:.6f}",
                    "" if vacancy.salary_from is None else int(vacancy.salary_from),
                    "" if vacancy.salary_to is None else int(vacancy.salary_to),
                    vacancy.currency,
                    vacancy.url,
                    vacancy.created_at or "",
                    vacancy.modified_at or "",
                ]
            )
        return buffer.getvalue()


def offline_vacancy_service(sample_path: Path = DEMO_VACANCIES_SAMPLE) -> VacancyService:
    """Сервис, работающий только на офлайн-срезе (для тестов без сети)."""

    sample_vacancies, sample_total = load_sample_vacancies(sample_path)

    def fetcher(count: int) -> tuple[list[Vacancy], int]:
        return sample_vacancies[:count], sample_total

    def page_fetcher(offset: int, limit: int) -> tuple[list[Vacancy], int]:
        start = offset * limit
        return sample_vacancies[start : start + limit], sample_total

    return VacancyService(fetcher=fetcher, page_fetcher=page_fetcher, sample_path=sample_path)
