"""Выгрузка сырых данных каталога в CSV (только для операторов платформы).

Issue #12: «нужна возможность скачать сырые данные (например csv) в каталоге
данных — мне нужно понять, с чем мы имеем дело… только для операторов
платформы».

Для датасета вакансий отдаётся исходный CSV «как есть». Для остальных
датасетов CSV собирается из связанных демонстрационных объектов, а если их
нет — из полей паспорта датасета.
"""

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from backend.app.schemas import TwinObject
    from backend.app.store import DemoStore
    from backend.app.vacancies_service import VacancyService

# UTF-8 BOM. Без него Excel под Windows с русской локалью читает CSV как
# windows-1251 и превращает кириллицу в «кракозябры» (issue #17). BOM —
# стандартный способ заставить Excel распознать кодировку UTF-8.
_BOM = "﻿"


def with_bom(csv_text: str) -> str:
    """Добавить UTF-8 BOM к CSV, если его ещё нет."""

    return csv_text if csv_text.startswith(_BOM) else _BOM + csv_text


def _centroid(geometry: dict) -> tuple[float | None, float | None]:
    coords = geometry.get("coordinates")
    points: list[list[float]] = []

    def walk(node: object) -> None:
        if (
            isinstance(node, (list, tuple))
            and len(node) == 2
            and all(isinstance(value, (int, float)) for value in node)
        ):
            points.append([float(node[0]), float(node[1])])
            return
        if isinstance(node, (list, tuple)):
            for child in node:
                walk(child)

    walk(coords)
    if not points:
        return None, None
    lon = sum(point[0] for point in points) / len(points)
    lat = sum(point[1] for point in points) / len(points)
    return lon, lat


def _objects_for_dataset(store: DemoStore, dataset_id: str) -> list[TwinObject]:
    layer_ids = {layer.id for layer in store.layers.values() if layer.dataset_id == dataset_id}
    return sorted(
        (item for item in store.objects.values() if item.layer_id in layer_ids),
        key=lambda item: item.id,
    )


def _objects_csv(objects: list[TwinObject]) -> str:
    property_keys: list[str] = []
    for item in objects:
        for key in item.properties:
            if key not in property_keys:
                property_keys.append(key)

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["id", "name", "object_type", "region", "oktmo", "lon", "lat", *property_keys])
    for item in objects:
        lon, lat = _centroid(item.geometry)
        writer.writerow(
            [
                item.id,
                item.name,
                item.object_type,
                item.region,
                item.oktmo,
                "" if lon is None else f"{lon:.5f}",
                "" if lat is None else f"{lat:.5f}",
                *[item.properties.get(key, "") for key in property_keys],
            ]
        )
    return buffer.getvalue()


def _passport_csv(store: DemoStore, dataset_id: str) -> str:
    dataset = store.datasets[dataset_id]
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["field", "value"])
    writer.writerow(["id", dataset.id])
    writer.writerow(["title", dataset.title])
    writer.writerow(["domain", dataset.domain])
    writer.writerow(["region", dataset.region])
    writer.writerow(["owner", dataset.owner])
    writer.writerow(["source", dataset.source])
    writer.writerow(["source_url", dataset.source_url])
    writer.writerow(["source_version", dataset.source_version.isoformat()])
    writer.writerow(["license", dataset.license])
    writer.writerow(["update_frequency", dataset.update_frequency])
    writer.writerow(["quality_flag", dataset.quality_flag])
    writer.writerow(["known_limitations", " | ".join(dataset.known_limitations)])
    return buffer.getvalue()


def build_dataset_csv(
    store: DemoStore,
    dataset_id: str,
    vacancy_service: VacancyService | None = None,
) -> tuple[str, str]:
    """Вернуть ``(имя_файла, текст_csv)`` сырых данных датасета."""

    if dataset_id.startswith("trudvsem") and vacancy_service is not None:
        return "trudvsem-vacancies.csv", with_bom(vacancy_service.csv_text())

    objects = _objects_for_dataset(store, dataset_id)
    if objects:
        return f"{dataset_id}-objects.csv", with_bom(_objects_csv(objects))
    return f"{dataset_id}-passport.csv", with_bom(_passport_csv(store, dataset_id))
