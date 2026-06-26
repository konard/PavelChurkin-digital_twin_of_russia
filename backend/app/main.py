from __future__ import annotations

import os
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from backend.app.auth import DEMO_ACCOUNTS, authenticate
from backend.app.export import render_markdown, render_pdf
from backend.app.gateway import require_open_contour, require_write_role
from backend.app.raw_export import build_dataset_csv
from backend.app.schemas import (
    ApiKeyRequest,
    ApiKeyResponse,
    AuditEntry,
    DatasetPassport,
    HealthResponse,
    Layer,
    LoginRequest,
    LoginResponse,
    Role,
    RoleInfo,
    RunRequest,
    Scenario,
    ScenarioRun,
    TwinObject,
)
from backend.app.store import DemoStore
from backend.app.vacancies_service import (
    DEFAULT_LIMIT,
    GUEST_LIMIT,
    MAX_LIMIT,
    VacancyService,
)

VERSION = "0.1.5"

app = FastAPI(
    title="API Цифрового двойника России",
    version=VERSION,
    summary="API открытого контура v0.1 с каталогом, слоями, сценариями, экспортами и аудитом.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = DemoStore()
vacancy_service = VacancyService()


@app.middleware("http")
async def security_headers(request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _role(value: str | None) -> Role:
    if value in {"guest", "citizen", "business", "developer", "operator"}:
        return value  # type: ignore[return-value]
    return "guest"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=VERSION, contour="open")


@app.get("/api/v1/config")
def get_config() -> dict:
    """Рантайм-конфигурация для фронтенда.

    Issue #21: подложка Яндекс Карт не включалась, потому что ключ
    ``VITE_YANDEX_API_KEY`` «запекался» в бандл только при сборке — после
    простого перезапуска контейнера кнопка оставалась неактивной. Теперь ключ
    можно задать переменной окружения бэкенда (``YANDEX_API_KEY``) и считать её
    в рантайме: достаточно перезапустить бэкенд, пересборка фронтенда не нужна.
    """

    yandex_key = (
        os.environ.get("YANDEX_API_KEY") or os.environ.get("VITE_YANDEX_API_KEY") or ""
    ).strip()
    return {"yandex_api_key": yandex_key, "yandex_enabled": bool(yandex_key)}


@app.get("/api/v1/auth/roles", response_model=list[RoleInfo])
def list_roles() -> list[RoleInfo]:
    """Роли открытого контура для экрана входа."""

    roles = [
        RoleInfo(
            role="guest",
            display_name="Гость",
            description="Демо-режим только для чтения: карта, каталог и "
            "предрассчитанные результаты сценариев без пароля.",
            can_write=False,
            requires_login=False,
        )
    ]
    for account in DEMO_ACCOUNTS.values():
        roles.append(
            RoleInfo(
                role=account.role,
                display_name=account.display_name,
                description=account.description,
                can_write=True,
                requires_login=True,
            )
        )
    return roles


@app.post("/api/v1/auth/login", response_model=LoginResponse)
def login(request: LoginRequest) -> LoginResponse:
    account = authenticate(request.username, request.password)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль. Для входа без пароля используйте гостевой режим.",
        )
    return LoginResponse(
        username=account.username,
        role=account.role,
        display_name=account.display_name,
        can_write=True,
    )


@app.get("/api/v1/catalog/datasets", response_model=list[DatasetPassport])
def list_datasets(
    domain: Annotated[str | None, Query()] = None,
    region: Annotated[str | None, Query()] = None,
    quality_flag: Annotated[str | None, Query()] = None,
) -> list[DatasetPassport]:
    datasets = store.list_datasets(domain=domain, region=region, quality_flag=quality_flag)
    for dataset in datasets:
        require_open_contour(dataset)
    return datasets


@app.get("/api/v1/catalog/datasets/{dataset_id}", response_model=DatasetPassport)
def get_dataset(dataset_id: str) -> DatasetPassport:
    try:
        dataset = store.datasets[dataset_id]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Датасет не найден"
        ) from exc
    require_open_contour(dataset)
    return dataset


@app.get("/api/v1/catalog/datasets/{dataset_id}/download")
def download_dataset_csv(
    dataset_id: str,
    x_role: Annotated[str | None, Header(alias="X-Role")] = None,
    x_actor: Annotated[str | None, Header(alias="X-Actor")] = None,
) -> Response:
    """Сырые данные датасета в CSV. Доступно только операторам платформы."""

    role = _role(x_role)
    if role != "operator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Выгрузка сырых данных доступна только операторам платформы.",
        )
    if dataset_id not in store.datasets:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Датасет не найден")
    dataset = store.datasets[dataset_id]
    require_open_contour(dataset)
    filename, csv_text = build_dataset_csv(store, dataset_id, vacancy_service)
    store.audit_log.append(
        actor=x_actor or "operator",
        role=role,
        action="catalog.download_raw",
        contour="open",
        target_id=dataset_id,
        data_versions={"source_version": dataset.source_version.isoformat()},
    )
    return Response(
        csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/v1/vacancies")
def get_vacancies(
    profession: Annotated[str | None, Query()] = None,
    count: Annotated[int | None, Query(ge=1, le=MAX_LIMIT)] = None,
    x_role: Annotated[str | None, Header(alias="X-Role")] = None,
) -> dict:
    """Слой вакансий «Работа России» из открытого API как GeoJSON.

    Issue #21: гостю отдаётся одна страница API (100 вакансий) — один запрос;
    авторизованные роли могут указать ``count`` и подгрузить нужное число
    вакансий (постранично, с паузой 0.21 с между запросами к источнику).
    """

    requested = count if count is not None else DEFAULT_LIMIT
    # Гость ограничен одной страницей API (issue #21: «один запрос апи для гостя»).
    if _role(x_role) == "guest":
        requested = GUEST_LIMIT
    return vacancy_service.geojson(profession=profession, count=requested)


@app.get("/api/v1/vacancies/professions")
def get_top_professions(
    limit: Annotated[int, Query(ge=1, le=100)] = 12,
    count: Annotated[int | None, Query(ge=1, le=MAX_LIMIT)] = None,
) -> list[dict]:
    """Топ профессий по числу вакансий для сайдбара и гистограммы."""

    return vacancy_service.top_professions(
        limit=limit, count=count if count is not None else DEFAULT_LIMIT
    )


@app.get("/api/v1/vacancies/meta")
def get_vacancies_meta() -> dict:
    """Метаданные слоя вакансий: источник, объём, периодичность обновления."""

    return vacancy_service.meta()


@app.get("/api/v1/layers", response_model=list[Layer])
def list_layers(
    domain: Annotated[str | None, Query()] = None,
    region: Annotated[str | None, Query()] = None,
) -> list[Layer]:
    return store.list_layers(domain=domain, region=region)


@app.get("/api/v1/tiles/{layer_id}/{z}/{x}/{y}")
def get_tile(layer_id: str, z: int, x: int, y: int) -> dict:
    if layer_id not in store.layers:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слой не найден")
    features = [
        {
            "type": "Feature",
            "geometry": item.geometry,
            "properties": {
                "id": item.id,
                "name": item.name,
                **item.properties,
                "source": item.provenance.source,
                "source_version": item.provenance.source_version.isoformat(),
                "license": item.provenance.license,
                "quality_flag": item.provenance.quality_flag,
                "known_limitations": item.provenance.known_limitations,
            },
        }
        for item in store.objects.values()
        if item.layer_id == layer_id
    ]
    return {
        "type": "FeatureCollection",
        "tile": {"z": z, "x": x, "y": y},
        "layer": layer_id,
        "features": features,
    }


@app.get("/api/v1/objects", response_model=list[TwinObject])
def list_objects(
    layer_id: Annotated[str | None, Query()] = None,
    region: Annotated[str | None, Query()] = None,
) -> list[TwinObject]:
    objects = list(store.objects.values())
    if layer_id:
        objects = [item for item in objects if item.layer_id == layer_id]
    if region:
        objects = [item for item in objects if item.region in {region, "Россия"}]
    return sorted(objects, key=lambda item: item.id)


@app.get("/api/v1/objects/{object_id}", response_model=TwinObject)
def get_object(object_id: str) -> TwinObject:
    try:
        return store.objects[object_id]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Объект не найден"
        ) from exc


@app.get("/api/v1/scenarios", response_model=list[Scenario])
def list_scenarios() -> list[Scenario]:
    return sorted(store.scenarios.values(), key=lambda scenario: scenario.id)


@app.post("/api/v1/scenarios/{scenario_id}/run", response_model=ScenarioRun)
def run_scenario(
    scenario_id: str,
    request: RunRequest,
    x_role: Annotated[str | None, Header(alias="X-Role")] = None,
    x_actor: Annotated[str | None, Header(alias="X-Actor")] = None,
) -> ScenarioRun:
    if scenario_id not in store.scenarios:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    role = _role(x_role)
    require_write_role(role)
    return store.create_run(
        scenario_id,
        request,
        actor=x_actor or "anonymous",
        role=role,
    )


@app.get("/api/v1/runs/{run_id}", response_model=ScenarioRun)
def get_run(run_id: str) -> ScenarioRun:
    try:
        return store.runs[run_id]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запуск не найден",
        ) from exc


@app.get("/api/v1/runs/{run_id}/export")
def export_run(
    run_id: str,
    format: Annotated[str, Query(pattern="^(md|pdf)$")] = "md",
    x_role: Annotated[str | None, Header(alias="X-Role")] = None,
    x_actor: Annotated[str | None, Header(alias="X-Actor")] = None,
) -> Response:
    if run_id not in store.runs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запуск не найден")
    run = store.runs[run_id]
    role = _role(x_role)
    store.audit_log.append(
        actor=x_actor or "anonymous",
        role=role,
        action="scenario.export",
        contour="open",
        target_id=run_id,
        data_versions={
            "dataset_version": run.dataset_version,
            "model_version": run.model_version,
            "scenario_version": run.scenario_version,
        },
    )
    if format == "pdf":
        return Response(
            render_pdf(run),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{run_id}.pdf"'},
        )
    return Response(
        render_markdown(run),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{run_id}.md"'},
    )


@app.post("/api/v1/auth/keys", response_model=ApiKeyResponse)
def create_api_key(
    request: ApiKeyRequest,
    x_role: Annotated[str | None, Header(alias="X-Role")] = None,
) -> ApiKeyResponse:
    role = _role(x_role)
    require_write_role(role)
    if role not in {"developer", "operator"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API-ключи доступны для ролей разработчика и оператора в v0.1.",
        )
    return ApiKeyResponse(
        name=request.name,
        key=f"dt_open_{request.name.lower().replace(' ', '_')}_demo",
        role=role,
        scopes=["catalog:read", "layers:read", "scenarios:run"],
    )


@app.get("/api/v1/audit", response_model=list[AuditEntry])
def list_audit(x_role: Annotated[str | None, Header(alias="X-Role")] = None) -> list[AuditEntry]:
    role = _role(x_role)
    if role not in {"developer", "operator"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Доступ к аудиту запрещён"
        )
    return store.audit_log.entries


@app.get("/api/v1/audit/verify")
def verify_audit() -> dict[str, bool]:
    return {"valid": store.audit_log.verify_chain()}


@app.get("/api/v1/about/limitations")
def limitations() -> dict[str, list[str]]:
    return {
        "v0.1": [
            "Включён только открытый контур.",
            "Персональные данные и схемы критической инфраструктуры не раскрываются.",
            "Демо-запуски детерминированы и используют сидированные паспорта открытых данных.",
            "ETL-коннекторы живых данных созданы как каркас; для производственного использования "
            "необходимо повторно проверить URL источников и лицензии.",
        ]
    }
