"""Коннектор вакансий «Работа России» («Труд всем»).

Issue #12 ставит первый слой карты — вакансии — и формулирует требования:

* источник одного файла на 500 000 вакансий —
  ``https://opendata.trudvsem.ru/csv/vacancy.csv``;
* потоковое чтение CSV без сохранения архива на диск
  (``stream=True`` у клиента, разбор «на лету»);
* инкрементальное обновление через параметр ``modifiedFrom`` у API
  «Работа России»;
* обновление данных раз в 1.5 дня (36 часов).

Разбор устроен «по заголовку»: имена колонок сопоставляются с набором
кандидатов без учёта регистра, поэтому коннектор устойчив к небольшим
расхождениям в реальной схеме выгрузки. Сетевой доступ вынесен в
инъектируемые функции, поэтому модуль тестируется офлайн на демо-файле.
"""

from __future__ import annotations

import csv
import io
import urllib.request
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

TRUDVSEM_CSV_URL = "https://opendata.trudvsem.ru/csv/vacancy.csv"
# Обновление данных по вакансиям — раз в 1.5 дня (issue #12).
REFRESH_INTERVAL_HOURS = 36

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_VACANCIES_CSV = REPO_ROOT / "data" / "demo" / "vacancies.csv"

# Кандидаты имён колонок (в нижнем регистре) для устойчивого разбора схемы.
_COLUMN_CANDIDATES: dict[str, tuple[str, ...]] = {
    "id": ("id", "vacancy_id", "globalid", "vacancyid"),
    "profession": (
        "profession",
        "job_name",
        "job-name",
        "jobname",
        "position",
        "vacancy_name",
        "name",
    ),
    "employer": ("employer", "company", "company_name", "companyname", "org"),
    "region": ("region", "region_name", "area", "location", "subject"),
    "salary_from": ("salary_from", "salaryfrom", "salary_min", "salary"),
    "salary_to": ("salary_to", "salaryto", "salary_max"),
    "currency": ("currency", "salary_currency"),
    "url": ("url", "vac_url", "link", "href"),
    "lat": ("lat", "latitude"),
    "lon": ("lon", "lng", "longitude"),
    "modified_at": ("modified_at", "modified", "modifiedfrom", "date_modify", "creation_date"),
}


@dataclass(frozen=True)
class Vacancy:
    id: str
    profession: str
    employer: str
    region: str
    lat: float | None = None
    lon: float | None = None
    salary_from: float | None = None
    salary_to: float | None = None
    currency: str = "RUB"
    url: str = ""
    modified_at: str | None = None

    @property
    def has_point(self) -> bool:
        return self.lat is not None and self.lon is not None


@dataclass
class _HeaderMap:
    """Сопоставление логических полей с индексами колонок CSV."""

    indices: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_header(cls, header: list[str]) -> _HeaderMap:
        normalized = [column.strip().lower() for column in header]
        indices: dict[str, int] = {}
        for field_name, candidates in _COLUMN_CANDIDATES.items():
            for candidate in candidates:
                if candidate in normalized:
                    indices[field_name] = normalized.index(candidate)
                    break
        return cls(indices=indices)

    def value(self, row: list[str], field_name: str) -> str:
        index = self.indices.get(field_name)
        if index is None or index >= len(row):
            return ""
        return row[index].strip()


def _to_float(value: str) -> float | None:
    if not value:
        return None
    cleaned = value.replace(",", ".").replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _detect_delimiter(header_line: str) -> str:
    # «Работа России» отдаёт точку с запятой; поддерживаем и запятую/таб.
    for delimiter in (";", "\t", ","):
        if delimiter in header_line:
            return delimiter
    return ";"


def iter_vacancies(
    lines: Iterable[str],
    *,
    limit: int | None = None,
    profession: str | None = None,
) -> Iterator[Vacancy]:
    """Потоково разобрать строки CSV в вакансии без загрузки файла целиком.

    ``lines`` — любой итерируемый источник строк (поток сети, файл, список),
    что и обеспечивает чтение «на лету».
    """

    iterator = iter(lines)
    try:
        header_line = next(iterator)
    except StopIteration:
        return
    delimiter = _detect_delimiter(header_line)
    header = next(csv.reader([header_line], delimiter=delimiter))
    mapping = _HeaderMap.from_header(header)
    needle = profession.strip().lower() if profession else None

    emitted = 0
    reader = csv.reader(iterator, delimiter=delimiter)
    for row in reader:
        if not row or not any(cell.strip() for cell in row):
            continue
        profession_value = mapping.value(row, "profession")
        if needle and needle not in profession_value.lower():
            continue
        vacancy = Vacancy(
            id=mapping.value(row, "id") or f"vac-{emitted}",
            profession=profession_value or "Без названия",
            employer=mapping.value(row, "employer"),
            region=mapping.value(row, "region"),
            lat=_to_float(mapping.value(row, "lat")),
            lon=_to_float(mapping.value(row, "lon")),
            salary_from=_to_float(mapping.value(row, "salary_from")),
            salary_to=_to_float(mapping.value(row, "salary_to")),
            currency=mapping.value(row, "currency") or "RUB",
            url=mapping.value(row, "url"),
            modified_at=mapping.value(row, "modified_at") or None,
        )
        yield vacancy
        emitted += 1
        if limit is not None and emitted >= limit:
            return


def stream_remote_lines(
    url: str = TRUDVSEM_CSV_URL,
    *,
    opener: object | None = None,
    encoding: str = "utf-8",
) -> Iterator[str]:
    """Потоково читать удалённый CSV построчно, не сохраняя файл на диск.

    Аналог ``requests.get(stream=True)``: данные читаются порциями из сетевого
    потока и сразу разбираются. По умолчанию используется стандартный
    ``urllib`` без дополнительных зависимостей.
    """

    open_fn = opener or urllib.request.urlopen  # noqa: S310
    request = urllib.request.Request(url, headers={"User-Agent": "DigitalTwinOfRussia/0.1.4"})
    response = open_fn(request)  # type: ignore[operator]
    with response:
        stream = io.TextIOWrapper(response, encoding=encoding, newline="")
        yield from stream


def fetch_remote_vacancies(
    url: str = TRUDVSEM_CSV_URL,
    *,
    limit: int | None = None,
    profession: str | None = None,
    modified_from: str | None = None,
) -> Iterator[Vacancy]:
    """Скачать и разобрать вакансии «на лету» из удалённого CSV.

    ``modified_from`` соответствует параметру ``modifiedFrom`` API
    «Работа России»: при инкрементальном режиме запрашиваются только
    изменившиеся записи. Для файловой выгрузки фильтр применяется к колонке
    даты изменения.
    """

    lines = stream_remote_lines(url)
    for vacancy in iter_vacancies(lines, limit=limit, profession=profession):
        if modified_from and vacancy.modified_at and vacancy.modified_at < modified_from:
            continue
        yield vacancy


def load_demo_vacancies(path: Path = DEMO_VACANCIES_CSV) -> list[Vacancy]:
    """Прочитать демонстрационную выгрузку вакансий из репозитория."""

    with path.open(encoding="utf-8", newline="") as file:
        return list(iter_vacancies(file))
