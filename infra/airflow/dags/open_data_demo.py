from __future__ import annotations

from datetime import datetime

from airflow.decorators import dag, task


@dag(
    dag_id="open_contour_demo_seed",
    start_date=datetime(2026, 6, 1),
    schedule="@monthly",
    catchup=False,
    tags=["digital-twin", "open-contour"],
)
def open_contour_demo_seed() -> None:
    @task
    def validate_passports() -> dict[str, int]:
        return {
            "queue_1_file_sources": 12,
            "queue_2_api_connectors": 2,
            "required_passport_fields": 14,
        }

    validate_passports()


open_contour_demo_seed()
