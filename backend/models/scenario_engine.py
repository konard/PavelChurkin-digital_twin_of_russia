from __future__ import annotations

from typing import Any

from backend.app.schemas import DatasetPassport, Scenario


def build_scenario_result(
    scenario: Scenario,
    *,
    region: str,
    parameters: dict[str, Any],
    datasets: list[DatasetPassport],
) -> dict[str, Any]:
    sources = [
        {
            "dataset_id": dataset.id,
            "source": dataset.source,
            "source_version": dataset.source_version.isoformat(),
            "license": dataset.license,
            "quality_flag": dataset.quality_flag,
            "known_limitations": dataset.known_limitations,
        }
        for dataset in datasets
    ]

    if scenario.id == "regional-passport":
        return {
            "summary": f"Паспорт ресурсов открытого контура для {region}.",
            "kpis": [
                {
                    "name": "Подключённые открытые датасеты",
                    "value": len(datasets),
                    "unit": "датасеты",
                },
                {"name": "Давление на рынок труда", "value": 0.47, "unit": "индекс"},
                {"name": "Транспортная доступность", "value": 0.82, "unit": "индекс"},
                {"name": "Актуальность данных", "value": "2026-06", "unit": "снимок"},
            ],
            "panels": ["Карта", "Экономика", "Труд", "Инфраструктура", "Риски"],
            "assumptions": [
                "Отчёт использует только открытые и агрегированные демо-записи.",
                "Отсутствующие муниципальные значения отображаются как "
                "ограничения, а не интерполированные факты.",
            ],
            "sources": sources,
        }

    if scenario.id == "workforce-deficit":
        profession = parameters.get("profession", "Разработчик программного обеспечения")
        return {
            "summary": f"Давление открытых вакансий для {profession} в {region}.",
            "heatmap": [
                {"oktmo": "45000000", "profession": profession, "deficit_index": 0.47},
                {"oktmo": "45097000", "profession": profession, "deficit_index": 0.34},
            ],
            "recommendations": [
                "Сравнивайте открытые вакансии с аккредитованными "
                "программами перед планированием набора.",
                "Рассматривайте результат как сигнал спроса, поскольку "
                "закрытые данные работодателей исключены.",
            ],
            "sources": sources,
        }

    if scenario.id == "site-comparison":
        sites = parameters.get("sites") or [
            "Северная площадка",
            "Южная логистическая площадка",
            "Восточная площадка",
        ]
        return {
            "summary": (
                f"Ранжированное сравнение открытых данных для {len(sites)} "
                "демо производственных площадок."
            ),
            "ranking": [
                {"site": site, "score": round(0.82 - index * 0.09, 2), "rank": index + 1}
                for index, site in enumerate(sites)
            ],
            "criteria": ["transport_access", "labor_availability", "climate_risk"],
            "sources": sources,
        }

    if scenario.id == "emergency-risk":
        return {
            "summary": f"Базовый экран аварийных рисков для {region}.",
            "risk_zones": [
                {"zone": "северо-восточный агрегат", "risk_score": 0.31, "driver": "fire_hotspots"},
                {"zone": "центральный агрегат", "risk_score": 0.22, "driver": "heat_anomaly"},
            ],
            "limitations": [
                "Это демо-экран рисков, а не оперативный прогноз ЧС.",
                "Чувствительные ресурсы реагирования и схемы инфраструктуры исключены.",
            ],
            "sources": sources,
        }

    if scenario.id == "relocation-calculator":
        cities = parameters.get("cities") or ["Москва", "Санкт-Петербург"]
        return {
            "summary": "Сравнение открытых данных для решений о переезде.",
            "cities": [
                {
                    "city": city,
                    "income_index": round(0.78 - index * 0.04, 2),
                    "infrastructure_index": round(0.88 - index * 0.03, 2),
                    "climate_comfort": round(0.61 + index * 0.05, 2),
                }
                for index, city in enumerate(cities[:4])
            ],
            "sources": sources,
        }

    return {
        "summary": f"Сценарий {scenario.id} выполнен.",
        "parameters": parameters,
        "sources": sources,
    }
