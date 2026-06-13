from __future__ import annotations

from backend.etl.base import SourceMetadata

STARTER_SOURCES: tuple[SourceMetadata, ...] = (
    SourceMetadata(
        id="osm-geofabrik",
        title="Пилотный экстракт OpenStreetMap Geofabrik",
        domain="geospatial",
        region="Москва",
        owner="Участники OpenStreetMap",
        source="OpenStreetMap / Geofabrik",
        source_url="https://download.geofabrik.de/russia.html",
        license="ODbL",
        update_frequency="monthly",
        classifier_alignment=["ОКТМО", "WGS-84"],
        known_limitations=["Полнота картографирования сообщества различается по районам."],
    ),
    SourceMetadata(
        id="rosstat-economy-demography",
        title="Показатели экономики и демографии Росстата",
        domain="statistics",
        region="Москва",
        owner="Росстат",
        source="Открытые данные Росстата",
        source_url="https://rosstat.gov.ru/opendata",
        license="Условия открытых данных Росстата",
        update_frequency="quarterly",
        classifier_alignment=["ОКТМО", "ОКВЭД2"],
        known_limitations=["Некоторые показатели публикуются с задержкой."],
    ),
    SourceMetadata(
        id="trudvsem-api",
        title="API-коннектор Работа России",
        domain="labor",
        region="Москва",
        owner="Минтруд России",
        source="Работа России REST API",
        source_url="https://trudvsem.ru/opendata/api",
        license="Условия открытых данных источника",
        update_frequency="daily",
        classifier_alignment=["ОКЗ", "ОКТМО"],
        known_limitations=["Коннектор должен обрабатывать пагинацию, повторные попытки и маркеры мягких сбоев."],
    ),
)


def describe_starter_sources() -> dict[str, int]:
    return {
        "declared_starter_sources": len(STARTER_SOURCES),
        "queue_1_file_sources": 12,
        "queue_2_api_connectors": 2,
    }
