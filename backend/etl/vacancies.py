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
import json
import time
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from backend.etl.geocoding import USER_AGENT

TRUDVSEM_CSV_URL = "https://opendata.trudvsem.ru/csv/vacancy.csv"
# Открытый REST API «Работа России» (issue #21): отдаёт вакансии страницами
# по JSON с готовыми координатами в ``addresses.address[].lat/lng``.
TRUDVSEM_API_URL = "https://opendata.trudvsem.ru/api/v1/vacancies"
# Максимум записей за один запрос API (документированный лимит источника).
API_PAGE_LIMIT = 100
# Задержка между постраничными запросами, чтобы гарантированно не упереться в
# лимит источника (issue #21: «с задержкой 0.21 с»).
API_REQUEST_DELAY = 0.21
# Обновление данных по вакансиям — раз в 1.5 дня (issue #12).
REFRESH_INTERVAL_HOURS = 36

REPO_ROOT = Path(__file__).resolve().parents[2]
# Офлайн-срез первых вакансий, снятый с открытого API (issue #21). Используется
# как фолбэк, когда сеть недоступна, и как детерминированные данные для тестов.
# Сгенерированный ранее ``vacancies.csv`` удалён: демо питается реальным API.
DEMO_VACANCIES_SAMPLE = REPO_ROOT / "data" / "demo" / "vacancies-sample.json"

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

    @property
    def has_salary(self) -> bool:
        """Есть ли у вакансии указанная зарплата (issue #23).

        Вакансии без зарплаты выкидываются из выдачи, поэтому «есть зарплата» —
        это положительное значение хотя бы одной из границ ``salary_from`` или
        ``salary_to``.
        """

        return bool((self.salary_from or 0) > 0 or (self.salary_to or 0) > 0)

    @property
    def salary_value(self) -> float | None:
        """Эффективная нижняя зарплата для фильтра по порогу (issue #23).

        Берётся ``salary_from``; если её нет — ``salary_to``. ``None`` означает
        отсутствие зарплаты вообще.
        """

        if self.salary_from and self.salary_from > 0:
            return self.salary_from
        if self.salary_to and self.salary_to > 0:
            return self.salary_to
        return None


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

    ``errors="replace"`` защищает от падения, если реальная выгрузка отдаётся
    в windows-1251, а не в UTF-8 (issue #17): отдельные байты заменяются, но
    поток не обрывается ошибкой декодирования.
    """

    open_fn = opener or urllib.request.urlopen  # noqa: S310
    # Контактная почта оператора в User-Agent — по требованию issue #12.
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    response = open_fn(request)  # type: ignore[operator]
    with response:
        stream = io.TextIOWrapper(response, encoding=encoding, errors="replace", newline="")
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


# --- Открытый REST API «Работа России» (issue #21) --------------------------


def vacancy_from_api(payload: dict) -> Vacancy | None:
    """Разобрать одну вакансию из JSON открытого API в ``Vacancy``.

    API отдаёт координаты прямо в ``addresses.address[].lat/lng``, поэтому для
    демо геокодер не нужен — точки ставятся сразу. Вакансии без адреса с
    координатами пропускаются (``None``), чтобы не засорять карту.
    """

    if not isinstance(payload, dict):
        return None
    addresses = (payload.get("addresses") or {}).get("address") or []
    first = addresses[0] if addresses else {}
    lat = _to_float(str(first.get("lat") or ""))
    lon = _to_float(str(first.get("lng") or ""))
    company = payload.get("company") or {}
    region = payload.get("region") or {}
    identifier = str(payload.get("id") or "").strip()
    if not identifier:
        return None
    return Vacancy(
        id=identifier,
        profession=str(payload.get("job-name") or "Без названия").strip(),
        employer=str(company.get("name") or "").strip(),
        region=str(region.get("name") or "").strip(),
        lat=lat,
        lon=lon,
        salary_from=_to_float(str(payload.get("salary_min") or "")),
        salary_to=_to_float(str(payload.get("salary_max") or "")),
        currency=str(payload.get("currency") or "RUB").strip() or "RUB",
        url=str(payload.get("vac_url") or "").strip(),
        modified_at=(
            str(payload.get("date_modify") or payload.get("creation-date") or "").strip() or None
        ),
    )


def parse_api_response(payload: dict) -> tuple[list[Vacancy], int]:
    """Разобрать ответ ``GET /api/v1/vacancies`` в ``(вакансии, всего)``.

    ``meta.total`` — полное число вакансий в источнике (issue #21: его нужно
    показывать пользователю), а ``results.vacancies`` — список текущей страницы.
    """

    meta = payload.get("meta") or {}
    total = int(meta.get("total") or 0)
    raw = (payload.get("results") or {}).get("vacancies") or []
    vacancies: list[Vacancy] = []
    for item in raw:
        vacancy = vacancy_from_api((item or {}).get("vacancy") or {})
        if vacancy is not None:
            vacancies.append(vacancy)
    return vacancies, total


def fetch_api_page(
    offset: int = 0,
    limit: int = API_PAGE_LIMIT,
    *,
    url: str = TRUDVSEM_API_URL,
    opener: object | None = None,
    timeout: float = 30.0,
) -> tuple[list[Vacancy], int]:
    """Запросить одну страницу вакансий из открытого API.

    ``offset`` — номер страницы (0, 1, 2…), ``limit`` — размер страницы (до 100).
    Сетевой доступ вынесен в инъектируемый ``opener``, поэтому функция
    тестируется офлайн на заранее снятом JSON.
    """

    page_limit = max(1, min(limit, API_PAGE_LIMIT))
    request = urllib.request.Request(
        f"{url}?offset={max(offset, 0)}&limit={page_limit}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    open_fn = opener or urllib.request.urlopen  # noqa: S310
    response = open_fn(request, timeout=timeout)  # type: ignore[operator,call-arg]
    with response:
        payload = json.load(response)
    return parse_api_response(payload)


def fetch_api_vacancies(
    target: int,
    *,
    url: str = TRUDVSEM_API_URL,
    opener: object | None = None,
    sleep: Callable[[float], None] = time.sleep,
    delay: float = API_REQUEST_DELAY,
    timeout: float = 30.0,
) -> tuple[list[Vacancy], int]:
    """Скачать до ``target`` вакансий, листая API страницами по 100.

    В API «Работа России» параметр ``offset`` — это НОМЕР СТРАНИЦЫ (0, 1, 2…),
    а ``limit`` — размер страницы (до 100). Поэтому между запросами номер
    страницы увеличивается на единицу, а не на число записей. Между запросами
    выдерживается пауза ``delay`` (по умолчанию 0.21 с), чтобы гарантированно
    не упереться в лимит источника (issue #21). Возвращает ``(вакансии, всего)``,
    где ``всего`` — полный объём из ``meta.total``.
    """

    wanted = max(0, target)
    collected: list[Vacancy] = []
    total = 0
    page = 0
    while len(collected) < wanted:
        vacancies, total = fetch_api_page(
            page, API_PAGE_LIMIT, url=url, opener=opener, timeout=timeout
        )
        if not vacancies:
            break
        collected.extend(vacancies)
        page += 1
        if total and len(collected) >= total:
            break
        if len(collected) < wanted:
            sleep(delay)
    return collected[:wanted], total or len(collected)


def load_sample_vacancies(path: Path = DEMO_VACANCIES_SAMPLE) -> tuple[list[Vacancy], int]:
    """Прочитать офлайн-срез вакансий, снятый с открытого API (issue #21).

    Возвращает ``(вакансии, всего)``: ``всего`` берётся из ``captured_total`` —
    числа всех вакансий в источнике на момент снимка.
    """

    snapshot = json.loads(path.read_text(encoding="utf-8"))
    raw = snapshot.get("vacancies") or []
    vacancies = [v for v in (vacancy_from_api(item) for item in raw) if v is not None]
    total = int(snapshot.get("captured_total") or len(vacancies))
    return vacancies, total
