from __future__ import annotations

from backend.etl.base import SourceMetadata

STARTER_SOURCES: tuple[SourceMetadata, ...] = (
    SourceMetadata(
        id="osm-geofabrik",
        title="OpenStreetMap Geofabrik pilot extract",
        domain="geospatial",
        region="Москва",
        owner="OpenStreetMap contributors",
        source="OpenStreetMap / Geofabrik",
        source_url="https://download.geofabrik.de/russia.html",
        license="ODbL",
        update_frequency="monthly",
        classifier_alignment=["ОКТМО", "WGS-84"],
        known_limitations=["Community mapping completeness differs by district."],
    ),
    SourceMetadata(
        id="rosstat-economy-demography",
        title="Rosstat economy and demography indicators",
        domain="statistics",
        region="Москва",
        owner="Росстат",
        source="Росстат open data",
        source_url="https://rosstat.gov.ru/opendata",
        license="Open data terms of Rosstat",
        update_frequency="quarterly",
        classifier_alignment=["ОКТМО", "ОКВЭД2"],
        known_limitations=["Some indicators are published with lag."],
    ),
    SourceMetadata(
        id="trudvsem-api",
        title="Работа России API connector",
        domain="labor",
        region="Москва",
        owner="Минтруд России",
        source="Работа России REST API",
        source_url="https://trudvsem.ru/opendata/api",
        license="Open data terms of source",
        update_frequency="daily",
        classifier_alignment=["ОКЗ", "ОКТМО"],
        known_limitations=["Connector must handle pagination, retries and soft outage markers."],
    ),
)


def describe_starter_sources() -> dict[str, int]:
    return {
        "declared_starter_sources": len(STARTER_SOURCES),
        "queue_1_file_sources": 12,
        "queue_2_api_connectors": 2,
    }
