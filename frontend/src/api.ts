import type {
  ApiKeyResponse,
  DatasetPassport,
  Layer,
  LoginResponse,
  RoleInfo,
  Scenario,
  ScenarioRun,
  Session,
  TwinObject,
} from "./types";

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

function authHeaders(session: Session): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Role": session.role,
    "X-Actor": session.username ?? "guest",
  };
}

export function fetchDatasets() {
  return getJson<DatasetPassport[]>("/api/v1/catalog/datasets", []);
}

export function fetchScenarios() {
  return getJson<Scenario[]>("/api/v1/scenarios", []);
}

export function fetchLayers() {
  return getJson<Layer[]>("/api/v1/layers", []);
}

export function fetchObjects() {
  return getJson<TwinObject[]>("/api/v1/objects", []);
}

export function fetchRoles() {
  return getJson<RoleInfo[]>("/api/v1/auth/roles", []);
}

export function fetchRun(runId: string) {
  return getJson<ScenarioRun | null>(`/api/v1/runs/${runId}`, null);
}

export function fetchDemoRun(scenarioId: string) {
  return fetchRun(`demo-${scenarioId}`);
}

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Не удалось войти.");
  }
  return (await response.json()) as LoginResponse;
}

export async function runScenario(
  session: Session,
  scenarioId: string,
  region: string,
  parameters: Record<string, unknown> = {},
): Promise<ScenarioRun> {
  const response = await fetch(
    `${API_BASE}/api/v1/scenarios/${scenarioId}/run`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ region, parameters }),
    },
  );
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Не удалось запустить сценарий.");
  }
  return (await response.json()) as ScenarioRun;
}

export async function createApiKey(
  session: Session,
  name: string,
): Promise<ApiKeyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/auth/keys`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Не удалось создать API-ключ.");
  }
  return (await response.json()) as ApiKeyResponse;
}

export function exportRunUrl(runId: string, format: "md" | "pdf") {
  return `${API_BASE}/api/v1/runs/${runId}/export?format=${format}`;
}
