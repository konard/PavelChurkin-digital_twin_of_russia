export type QualityFlag = "verified" | "aggregated" | "draft" | "outdated";

export type Role = "guest" | "citizen" | "business" | "developer" | "operator";

export interface DatasetPassport {
  id: string;
  title: string;
  domain: string;
  region: string;
  owner: string;
  source: string;
  source_url: string;
  source_version: string;
  license: string;
  update_frequency: string;
  quality_flag: QualityFlag;
  known_limitations: string[];
  contour: "open";
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  version: string;
  model_version: string;
  description: string;
  data_requirements: string[];
  demo: boolean;
}

export interface ScenarioSource {
  dataset_id: string;
  source: string;
  source_version: string;
  license: string;
  quality_flag: QualityFlag;
  known_limitations: string[];
}

export interface ScenarioRun {
  id: string;
  scenario_id: string;
  dataset_version: string;
  model_version: string;
  scenario_version: string;
  result: {
    summary: string;
    sources: ScenarioSource[];
    [key: string]: unknown;
  };
}

export interface Layer {
  id: string;
  name: string;
  dataset_id: string;
  domain: string;
  region: string;
  geometry_type: "Point" | "LineString" | "Polygon" | "MultiPolygon";
  style: Record<string, unknown>;
}

export interface TwinObject {
  id: string;
  name: string;
  layer_id: string;
  object_type: string;
  region: string;
  oktmo: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
  provenance: {
    source: string;
    source_version: string;
    license: string;
    quality_flag: QualityFlag;
    known_limitations: string[];
  };
}

export interface ProfessionCount {
  profession: string;
  count: number;
}

export interface VacancyMeta {
  source: string;
  source_csv_url: string;
  dataset_id: string;
  total: number;
  professions: number;
  regions: number;
  refresh_interval_hours: number;
  incremental_param: string;
  geocoder: string;
  note: string;
}

export type VacancyFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  {
    id: string;
    profession: string;
    employer: string;
    region: string;
    salary: string | null;
    url: string;
  }
>;

export interface RoleInfo {
  role: Role;
  display_name: string;
  description: string;
  can_write: boolean;
  requires_login: boolean;
}

export interface Session {
  role: Role;
  display_name: string;
  username: string | null;
  can_write: boolean;
}

export interface LoginResponse {
  username: string;
  role: Role;
  display_name: string;
  can_write: boolean;
}

export interface ApiKeyResponse {
  name: string;
  key: string;
  role: Role;
  scopes: string[];
}
