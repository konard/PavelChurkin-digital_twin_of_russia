from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Contour = Literal["open", "departmental", "infrastructure", "closed", "research"]
QualityFlag = Literal["verified", "aggregated", "draft", "outdated"]
PiiStatus = Literal["none", "aggregated", "anonymized", "pseudonymized"]
AggregationLevel = Literal["region", "municipality", "settlement", "object"]
ScenarioStatus = Literal["queued", "running", "succeeded", "failed"]
Role = Literal["guest", "citizen", "business", "developer", "operator"]


class Provenance(BaseModel):
    source: str
    source_version: date
    license: str
    quality_flag: QualityFlag
    known_limitations: list[str] = Field(default_factory=list)


class DatasetPassport(BaseModel):
    id: str
    title: str
    domain: str
    region: str
    owner: str
    source: str
    source_url: str
    source_version: date
    license: str
    update_frequency: str
    classifier_alignment: list[str]
    geometry_crs: str = "EPSG:4326"
    pii_status: PiiStatus = "aggregated"
    k_anonymity: int = 10
    known_limitations: list[str]
    validators: list[str]
    signed_by: str
    certificate_version: str
    signed_at: datetime
    quality_flag: QualityFlag = "aggregated"
    contour: Contour = "open"

    @property
    def provenance(self) -> Provenance:
        return Provenance(
            source=self.source,
            source_version=self.source_version,
            license=self.license,
            quality_flag=self.quality_flag,
            known_limitations=self.known_limitations,
        )


class Layer(BaseModel):
    id: str
    name: str
    dataset_id: str
    domain: str
    region: str
    geometry_type: Literal["Point", "LineString", "Polygon", "MultiPolygon"]
    style: dict[str, Any] = Field(default_factory=dict)
    provenance: Provenance
    contour: Contour = "open"


class TwinObject(BaseModel):
    id: str
    name: str
    layer_id: str
    object_type: str
    region: str
    oktmo: str
    properties: dict[str, Any]
    geometry: dict[str, Any]
    provenance: Provenance
    classifier_codes: dict[str, str | None] = Field(default_factory=dict)
    aggregation_level: AggregationLevel = "municipality"
    pii_status: PiiStatus = "aggregated"
    contour: Contour = "open"


class Scenario(BaseModel):
    id: str
    title: str
    category: str
    version: str
    model_version: str
    contour: Contour = "open"
    description: str
    parameters_schema: dict[str, Any]
    data_requirements: list[str]
    demo: bool = True
    writable_roles: list[Role] = Field(default_factory=lambda: ["citizen", "business", "developer"])


class ScenarioRun(BaseModel):
    id: str
    scenario_id: str
    status: ScenarioStatus = "succeeded"
    requested_by: str
    role: Role
    parameters: dict[str, Any]
    dataset_version: str
    model_version: str
    scenario_version: str
    result: dict[str, Any]
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class RunRequest(BaseModel):
    region: str = "Москва"
    parameters: dict[str, Any] = Field(default_factory=dict)


class ApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ApiKeyResponse(BaseModel):
    name: str
    key: str
    role: Role
    scopes: list[str]


class AuditEntry(BaseModel):
    index: int
    timestamp: datetime
    actor: str
    role: Role
    action: str
    contour: Contour
    target_id: str
    data_versions: dict[str, str]
    previous_hash: str
    hash: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    contour: Literal["open"]
