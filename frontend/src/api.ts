import type { DatasetPassport, Scenario, ScenarioRun } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
      return fallback;
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export function fetchDatasets() {
  return getJson<DatasetPassport[]>("/api/v1/catalog/datasets", []);
}

export function fetchScenarios() {
  return getJson<Scenario[]>("/api/v1/scenarios", []);
}

export function fetchDemoRun() {
  return getJson<ScenarioRun | null>(
    "/api/v1/runs/demo-regional-passport",
    null,
  );
}
