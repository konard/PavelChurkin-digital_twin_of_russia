import type {
  ApiKeyResponse,
  AppConfig,
  DatasetPassport,
  Layer,
  LoginResponse,
  ProfessionCount,
  RoleInfo,
  Scenario,
  ScenarioRun,
  Session,
  TwinObject,
  VacancyCollection,
  VacancyFeatureCollection,
  VacancyMeta,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function getJson<T>(
  path: string,
  fallback: T,
  headers?: Record<string, string>,
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { headers });
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

/**
 * Заголовки роли для GET-запросов слоя вакансий. Бэкенд по ``X-Role`` решает,
 * сколько вакансий отдать: гостю — одна страница API, остальным — указанное
 * число (issue #21).
 */
function roleHeaders(session?: Session): Record<string, string> {
  if (!session) {
    return {};
  }
  return { "X-Role": session.role, "X-Actor": session.username ?? "guest" };
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

const EMPTY_VACANCIES: VacancyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_VACANCY_COLLECTION: VacancyCollection = {
  ...EMPTY_VACANCIES,
  total: 0,
  loaded: 0,
  returned: 0,
};

/**
 * Загрузить слой вакансий из открытого API «Работа России» (issue #21).
 *
 * ``count`` — сколько вакансий подгрузить. Гостю бэкенд всё равно отдаёт одну
 * страницу (заголовок ``X-Role`` из ``session``); авторизованным ролям
 * доступно указанное число. Без ``session`` запрос идёт как гостевой.
 */
export function fetchVacancies(
  profession?: string,
  count?: number,
  session?: Session,
) {
  const params = new URLSearchParams();
  if (profession) {
    params.set("profession", profession);
  }
  if (count !== undefined) {
    params.set("count", String(count));
  }
  const query = params.toString();
  return getJson<VacancyCollection>(
    `/api/v1/vacancies${query ? `?${query}` : ""}`,
    EMPTY_VACANCY_COLLECTION,
    roleHeaders(session),
  );
}

export function fetchTopProfessions(
  limit = 12,
  count?: number,
  session?: Session,
) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (count !== undefined) {
    params.set("count", String(count));
  }
  return getJson<ProfessionCount[]>(
    `/api/v1/vacancies/professions?${params.toString()}`,
    [],
    roleHeaders(session),
  );
}

export function fetchVacanciesMeta() {
  return getJson<VacancyMeta | null>("/api/v1/vacancies/meta", null);
}

/** Рантайм-конфигурация контура (issue #21: ключ Яндекса без пересборки). */
export function fetchConfig() {
  return getJson<AppConfig>("/api/v1/config", {
    yandex_api_key: "",
    yandex_enabled: false,
  });
}

/**
 * Скачать сырой CSV датасета. Эндпоинт требует роль оператора в заголовке
 * X-Role, поэтому запрос идёт через fetch с последующим сохранением blob,
 * а не простой ссылкой.
 */
export async function downloadDatasetCsv(
  session: Session,
  datasetId: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/v1/catalog/datasets/${datasetId}/download`,
    {
      headers: {
        "X-Role": session.role,
        "X-Actor": session.username ?? "operator",
      },
    },
  );
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Не удалось скачать данные.");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `${datasetId}.csv`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
