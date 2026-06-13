export type QualityFlag = "verified" | "aggregated" | "draft" | "outdated";

export interface DatasetPassport {
  id: string;
  title: string;
  domain: string;
  region: string;
  owner: string;
  source: string;
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

export interface ScenarioRun {
  id: string;
  scenario_id: string;
  dataset_version: string;
  model_version: string;
  scenario_version: string;
  result: {
    summary: string;
    sources: Array<{
      dataset_id: string;
      source: string;
      source_version: string;
      license: string;
      quality_flag: QualityFlag;
      known_limitations: string[];
    }>;
  };
}
