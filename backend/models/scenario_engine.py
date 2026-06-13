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
            "summary": f"Open-contour resource passport for {region}.",
            "kpis": [
                {"name": "Connected open datasets", "value": len(datasets), "unit": "datasets"},
                {"name": "Workforce pressure", "value": 0.47, "unit": "index"},
                {"name": "Transport availability", "value": 0.82, "unit": "index"},
                {"name": "Data freshness", "value": "2026-06", "unit": "snapshot"},
            ],
            "panels": ["Map", "Economy", "Labor", "Infrastructure", "Risk"],
            "assumptions": [
                "The report uses only open and aggregated demo records.",
                "Missing municipal values are shown as limitations, not interpolated facts.",
            ],
            "sources": sources,
        }

    if scenario.id == "workforce-deficit":
        profession = parameters.get("profession", "Software developer")
        return {
            "summary": f"Open vacancy pressure for {profession} in {region}.",
            "heatmap": [
                {"oktmo": "45000000", "profession": profession, "deficit_index": 0.47},
                {"oktmo": "45097000", "profession": profession, "deficit_index": 0.34},
            ],
            "recommendations": [
                "Compare open vacancies with accredited programs before planning intake.",
                "Treat the result as a demand signal because it excludes closed employer data.",
            ],
            "sources": sources,
        }

    if scenario.id == "site-comparison":
        sites = parameters.get("sites") or ["North site", "South logistics site", "East site"]
        return {
            "summary": f"Ranked open-data comparison for {len(sites)} demo production sites.",
            "ranking": [
                {"site": site, "score": round(0.82 - index * 0.09, 2), "rank": index + 1}
                for index, site in enumerate(sites)
            ],
            "criteria": ["transport_access", "labor_availability", "climate_risk"],
            "sources": sources,
        }

    if scenario.id == "emergency-risk":
        return {
            "summary": f"Basic emergency-risk screen for {region}.",
            "risk_zones": [
                {"zone": "north-east aggregate", "risk_score": 0.31, "driver": "fire_hotspots"},
                {"zone": "central aggregate", "risk_score": 0.22, "driver": "heat_anomaly"},
            ],
            "limitations": [
                "This is a demo risk screen, not an operational emergency forecast.",
                "Sensitive response resources and infrastructure schemes are excluded.",
            ],
            "sources": sources,
        }

    if scenario.id == "relocation-calculator":
        cities = parameters.get("cities") or ["Москва", "Санкт-Петербург"]
        return {
            "summary": "Open-data comparison for relocation decisions.",
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
        "summary": f"Scenario {scenario.id} completed.",
        "parameters": parameters,
        "sources": sources,
    }
