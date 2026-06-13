import "maplibre-gl/dist/maplibre-gl.css";

import {
  Archive,
  FileDown,
  KeyRound,
  LogOut,
  Map as MapIcon,
  Play,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createApiKey,
  exportRunUrl,
  fetchDatasets,
  fetchDemoRun,
  fetchObjects,
  fetchRoles,
  fetchScenarios,
  login,
  runScenario,
} from "./api";
import type {
  ApiKeyResponse,
  DatasetPassport,
  RoleInfo,
  Scenario,
  ScenarioRun,
  Session,
  TwinObject,
} from "./types";

const SESSION_KEY = "dtr.session";

const qualityLabels: Record<string, string> = {
  verified: "проверено",
  aggregated: "агрегировано",
  draft: "черновик",
  outdated: "устарело",
};

const roleLabels: Record<string, string> = {
  guest: "Гость",
  citizen: "Гражданин",
  business: "Бизнес",
  developer: "Разработчик",
  operator: "Оператор платформы",
};

type View = "map" | "scenarios" | "catalog" | "reports" | "account";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function objectPopupHtml(item: TwinObject): string {
  const rows = Object.entries(item.properties)
    .map(([key, value]) => `<div><b>${key}</b>: ${String(value)}</div>`)
    .join("");
  return `
    <div class="map-popup">
      <strong>${item.name}</strong>
      <div class="map-popup-meta">${item.region} · ОКТМО ${item.oktmo}</div>
      ${rows}
      <div class="map-popup-src">
        Источник: ${item.provenance.source}<br/>
        Версия: ${item.provenance.source_version} · Лицензия: ${item.provenance.license}
      </div>
    </div>`;
}

function MapPanel({ objects }: { objects: TwinObject[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const objectFeatures: GeoJSON.Feature[] = objects.map((item) => ({
      type: "Feature",
      properties: { id: item.id, name: item.name, html: objectPopupHtml(item) },
      geometry: item.geometry as GeoJSON.Geometry,
    }));

    const style: StyleSpecification = {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
        regions: {
          type: "geojson",
          data: "/regions-russia.geojson",
        },
        objects: {
          type: "geojson",
          data: { type: "FeatureCollection", features: objectFeatures },
        },
      },
      layers: [
        { id: "basemap", type: "raster", source: "basemap" },
        {
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: { "fill-color": "#3b82f6", "fill-opacity": 0.12 },
        },
        {
          id: "regions-outline",
          type: "line",
          source: "regions",
          paint: { "line-color": "#1d4ed8", "line-width": 0.8 },
        },
        {
          id: "obj-fill",
          type: "fill",
          source: "objects",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#dc2626", "fill-opacity": 0.4 },
        },
        {
          id: "obj-line",
          type: "line",
          source: "objects",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#2563eb", "line-width": 3 },
        },
        {
          id: "obj-points",
          type: "circle",
          source: "objects",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#0f766e",
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        },
      ],
    };

    const map = new maplibregl.Map({
      container: ref.current,
      style,
      center: [94, 64],
      zoom: 2.4,
      interactive: true,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
    });

    const objectLayers = ["obj-fill", "obj-line", "obj-points"];
    for (const layer of objectLayers) {
      map.on("click", layer, (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }
        popup
          .setLngLat(event.lngLat)
          .setHTML(String(feature.properties?.html ?? ""))
          .addTo(map);
      });
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    map.on("click", "regions-fill", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<div class="map-popup"><strong>${String(
            feature.properties?.name ?? "Регион",
          )}</strong><div class="map-popup-meta">Субъект РФ — привязка данных по координатам в развитии</div></div>`,
        )
        .addTo(map);
    });

    return () => map.remove();
  }, [objects]);

  return (
    <div ref={ref} className="map-canvas" aria-label="Карта регионов России" />
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchRoles().then(setRoles);
  }, []);

  const loginRoles = roles.filter((role) => role.requires_login);

  const enterAsGuest = () => {
    onLogin({
      role: "guest",
      display_name: "Гость",
      username: null,
      can_write: false,
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await login(username, password);
      onLogin({
        role: response.role,
        display_name: response.display_name,
        username: response.username,
        can_write: response.can_write,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand login-brand">DTR</div>
        <h1>Цифровой двойник России</h1>
        <p className="login-sub">
          Открытый контур v0.1.3. Войдите как оператор платформы или другая роль
          — либо продолжите как гость без пароля.
        </p>

        <button type="button" className="guest-button" onClick={enterAsGuest}>
          Войти как гость (без пароля, только чтение)
        </button>

        <div className="login-divider">
          <span>или вход по логину</span>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            Логин
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Вход..." : "Войти"}
          </button>
        </form>

        {loginRoles.length > 0 && (
          <div className="demo-accounts">
            <h2>Демо-учётные записи</h2>
            <ul>
              {loginRoles.map((role) => (
                <li key={role.role}>
                  <code>{role.role}</code> / <code>{role.role}2026</code> —{" "}
                  {role.display_name}: {role.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function RunResultView({ run }: { run: ScenarioRun }) {
  const { summary, sources, ...rest } = run.result;
  const detailEntries = Object.entries(rest).filter(([key]) => key !== "kpis");
  const kpis =
    (run.result.kpis as
      | Array<{ name: string; value: unknown; unit?: string }>
      | undefined) ?? [];

  return (
    <div className="run-result">
      <p className="run-summary">{summary}</p>

      {kpis.length > 0 && (
        <div className="kpi-grid">
          {kpis.map((kpi) => (
            <article key={kpi.name}>
              <span>{kpi.name}</span>
              <strong>
                {String(kpi.value)}
                {kpi.unit ? <small> {kpi.unit}</small> : null}
              </strong>
            </article>
          ))}
        </div>
      )}

      {detailEntries.map(([key, value]) => (
        <div key={key} className="run-detail">
          <h4>{key}</h4>
          <pre>{JSON.stringify(value, null, 2)}</pre>
        </div>
      ))}

      <dl className="run-versions">
        <div>
          <dt>Версия датасета</dt>
          <dd>{run.dataset_version}</dd>
        </div>
        <div>
          <dt>Версия модели</dt>
          <dd>{run.model_version}</dd>
        </div>
        <div>
          <dt>Версия сценария</dt>
          <dd>{run.scenario_version}</dd>
        </div>
      </dl>

      <h4>Источники и ограничения</h4>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.dataset_id}>
            <strong>{source.source}</strong> ({source.dataset_id}), версия{" "}
            {source.source_version}, лицензия: {source.license},{" "}
            <span className={`quality quality-${source.quality_flag}`}>
              {qualityLabels[source.quality_flag]}
            </span>
            {source.known_limitations.length > 0 && (
              <ul>
                {source.known_limitations.map((limitation) => (
                  <li key={limitation}>ограничение: {limitation}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="export-row">
        <a href={exportRunUrl(run.id, "md")} className="export-link">
          <FileDown size={15} /> Markdown
        </a>
        <a href={exportRunUrl(run.id, "pdf")} className="export-link">
          <FileDown size={15} /> PDF
        </a>
      </div>
    </div>
  );
}

function MapView({ objects }: { objects: TwinObject[] }) {
  return (
    <section className="panel">
      <div className="section-title">
        <MapIcon size={18} />
        <h2>Карта открытого контура</h2>
      </div>
      <MapPanel objects={objects} />
      <p className="panel-note">
        Подсвечены все субъекты РФ. Кликните по региону, чтобы увидеть его
        название, или по объекту — чтобы увидеть карточку с источником данных. В
        дальнейшем открытые данные (например, координаты работодателей из{" "}
        <code>opendata.trudvsem.ru</code>) будут сопоставляться к каждому
        региону.
      </p>
    </section>
  );
}

function ScenariosView({
  session,
  scenarios,
  onRun,
}: {
  session: Session;
  scenarios: Scenario[];
  onRun: (run: ScenarioRun) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async (scenario: Scenario) => {
    setActiveId(scenario.id);
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      let result: ScenarioRun | null;
      if (session.can_write) {
        result = await runScenario(session, scenario.id, "Москва");
      } else {
        result = await fetchDemoRun(scenario.id);
      }
      if (!result) {
        throw new Error("Результат сценария недоступен.");
      }
      setRun(result);
      onRun(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось выполнить запуск.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="section-title">
        <Play size={18} />
        <h2>Демо-сценарии</h2>
      </div>
      {!session.can_write && (
        <p className="panel-note">
          Гостевой режим: показываются предрассчитанные демо-результаты только
          для чтения. Войдите под ролью, чтобы запускать сценарии заново.
        </p>
      )}
      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <article
            key={scenario.id}
            className={`scenario-card${activeId === scenario.id ? " active" : ""}`}
          >
            <div>
              <strong>{scenario.title}</strong>
              <span>{scenario.description}</span>
              <small>{scenario.version}</small>
            </div>
            <button
              type="button"
              onClick={() => void activate(scenario)}
              disabled={busy && activeId === scenario.id}
            >
              {busy && activeId === scenario.id
                ? "Выполняется..."
                : session.can_write
                  ? "Запустить"
                  : "Открыть демо"}
            </button>
          </article>
        ))}
      </div>

      {error && <p className="login-error">{error}</p>}
      {run && (
        <div className="panel inner-panel">
          <div className="section-title">
            <FileDown size={18} />
            <h2>Результат: {run.scenario_id}</h2>
          </div>
          <RunResultView run={run} />
        </div>
      )}
    </section>
  );
}

function CatalogView({ datasets }: { datasets: DatasetPassport[] }) {
  const [domain, setDomain] = useState<string>("");
  const domains = useMemo(
    () => Array.from(new Set(datasets.map((dataset) => dataset.domain))).sort(),
    [datasets],
  );
  const filtered = domain
    ? datasets.filter((dataset) => dataset.domain === domain)
    : datasets;

  return (
    <section className="panel">
      <div className="section-title">
        <Archive size={18} />
        <h2>Каталог данных ({filtered.length})</h2>
        <select
          className="domain-filter"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        >
          <option value="">Все домены</option>
          {domains.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="catalog-scroll">
        <table>
          <thead>
            <tr>
              <th>Датасет</th>
              <th>Домен</th>
              <th>Владелец</th>
              <th>Версия</th>
              <th>Лицензия</th>
              <th>Качество</th>
              <th>Ограничения</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((dataset) => (
              <tr key={dataset.id}>
                <td>
                  <a href={dataset.source_url} target="_blank" rel="noreferrer">
                    {dataset.title}
                  </a>
                </td>
                <td>{dataset.domain}</td>
                <td>{dataset.owner}</td>
                <td>{dataset.source_version}</td>
                <td>{dataset.license}</td>
                <td>
                  <span className={`quality quality-${dataset.quality_flag}`}>
                    {qualityLabels[dataset.quality_flag]}
                  </span>
                </td>
                <td>{dataset.known_limitations.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportsView({ run }: { run: ScenarioRun | null }) {
  return (
    <section className="panel">
      <div className="section-title">
        <FileDown size={18} />
        <h2>Отчёты</h2>
      </div>
      {run ? (
        <RunResultView run={run} />
      ) : (
        <p className="panel-note">
          Запустите или откройте сценарий на вкладке «Сценарии», чтобы здесь
          появился отчёт с источниками и версиями данных.
        </p>
      )}
    </section>
  );
}

function AccountView({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [keyName, setKeyName] = useState("demo-key");
  const [apiKey, setApiKey] = useState<ApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canCreateKey =
    session.role === "developer" || session.role === "operator";

  const create = async () => {
    setError(null);
    try {
      setApiKey(await createApiKey(session, keyName));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось создать ключ.",
      );
    }
  };

  return (
    <section className="panel">
      <div className="section-title">
        <UserRound size={18} />
        <h2>Кабинет</h2>
      </div>
      <div className="account-body">
        <dl className="run-versions">
          <div>
            <dt>Роль</dt>
            <dd>{roleLabels[session.role] ?? session.role}</dd>
          </div>
          <div>
            <dt>Пользователь</dt>
            <dd>{session.username ?? "аноним (гость)"}</dd>
          </div>
          <div>
            <dt>Права записи</dt>
            <dd>{session.can_write ? "да" : "нет (только чтение)"}</dd>
          </div>
        </dl>

        <div className="api-key-block">
          <h4>API-ключи</h4>
          {canCreateKey ? (
            <>
              <div className="api-key-form">
                <input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                />
                <button type="button" onClick={() => void create()}>
                  <KeyRound size={15} /> Создать ключ
                </button>
              </div>
              {apiKey && (
                <p className="api-key-value">
                  <code>{apiKey.key}</code>
                  <br />
                  области: {apiKey.scopes.join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="panel-note">
              API-ключи доступны для ролей «Разработчик» и «Оператор платформы».
            </p>
          )}
          {error && <p className="login-error">{error}</p>}
        </div>

        <button type="button" className="logout-button" onClick={onLogout}>
          <LogOut size={15} /> Выйти
        </button>
      </div>
    </section>
  );
}

function Workspace({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>("map");
  const [datasets, setDatasets] = useState<DatasetPassport[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [objects, setObjects] = useState<TwinObject[]>([]);
  const [lastRun, setLastRun] = useState<ScenarioRun | null>(null);

  useEffect(() => {
    void fetchDatasets().then(setDatasets);
    void fetchScenarios().then(setScenarios);
    void fetchObjects().then(setObjects);
    void fetchDemoRun("regional-passport").then(setLastRun);
  }, []);

  const domains = useMemo(
    () => Array.from(new Set(datasets.map((dataset) => dataset.domain))).sort(),
    [datasets],
  );

  const navItems: Array<{ id: View; label: string; icon: typeof MapIcon }> = [
    { id: "map", label: "Карта", icon: MapIcon },
    { id: "scenarios", label: "Сценарии", icon: Play },
    { id: "catalog", label: "Каталог", icon: Archive },
    { id: "reports", label: "Отчёты", icon: FileDown },
    { id: "account", label: "Кабинет", icon: UserRound },
  ];

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Модули">
        <div className="brand">DTR</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              title={item.label}
              className={view === item.id ? "rail-active" : ""}
              onClick={() => setView(item.id)}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Цифровой двойник России v0.1.3</h1>
            <p>
              Открытый контур: каталоги, сценарии, отчёты и аудит на
              демо-данных.
            </p>
          </div>
          <div className="topbar-right">
            <div className="status-pill">
              <ShieldCheck size={17} />
              открытый контур
            </div>
            <div className="role-pill">
              <UserRound size={15} />
              {roleLabels[session.role] ?? session.role}
            </div>
            <button type="button" className="logout-mini" onClick={onLogout}>
              <LogOut size={15} />
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Метрики готовности">
          <article>
            <span>датасеты</span>
            <strong>{datasets.length || "..."}</strong>
          </article>
          <article>
            <span>домены</span>
            <strong>{domains.length || "..."}</strong>
          </article>
          <article>
            <span>сценарии</span>
            <strong>{scenarios.length || "..."}</strong>
          </article>
          <article>
            <span>объекты карты</span>
            <strong>{objects.length || "..."}</strong>
          </article>
        </section>

        {view === "map" && <MapView objects={objects} />}
        {view === "scenarios" && (
          <ScenariosView
            session={session}
            scenarios={scenarios}
            onRun={setLastRun}
          />
        )}
        {view === "catalog" && <CatalogView datasets={datasets} />}
        {view === "reports" && <ReportsView run={lastRun} />}
        {view === "account" && (
          <AccountView session={session} onLogout={onLogout} />
        )}
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const handleLogin = (next: Session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  };

  const handleLogout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }
  return <Workspace session={session} onLogout={handleLogout} />;
}

export default App;
