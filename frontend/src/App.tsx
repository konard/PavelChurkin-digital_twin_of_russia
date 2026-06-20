import "maplibre-gl/dist/maplibre-gl.css";

import {
  Archive,
  Briefcase,
  Download,
  FileDown,
  KeyRound,
  Layers,
  LogOut,
  Map as MapIcon,
  Play,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import maplibregl, {
  type SourceSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createApiKey,
  downloadDatasetCsv,
  exportRunUrl,
  fetchDatasets,
  fetchDemoRun,
  fetchObjects,
  fetchRoles,
  fetchScenarios,
  fetchTopProfessions,
  fetchVacancies,
  fetchVacanciesMeta,
  login,
  runScenario,
} from "./api";
import type {
  ApiKeyResponse,
  DatasetPassport,
  ProfessionCount,
  RoleInfo,
  Scenario,
  ScenarioRun,
  Session,
  TwinObject,
  VacancyFeatureCollection,
  VacancyMeta,
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

type Basemap = "osm" | "yandex";

const YANDEX_API_KEY = import.meta.env.VITE_YANDEX_API_KEY ?? "";

function basemapSource(basemap: Basemap): SourceSpecification {
  if (basemap === "yandex" && YANDEX_API_KEY) {
    // Подключение Яндекс Карт включается только при наличии API-ключа.
    // Лимиты бесплатного плана соблюдаются на стороне геокодера (см. docs).
    return {
      type: "raster",
      tiles: [
        `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&l=map&lang=ru_RU&apikey=${YANDEX_API_KEY}`,
      ],
      tileSize: 256,
      attribution: "© Яндекс Карты",
    };
  }
  return {
    type: "raster",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: "© OpenStreetMap contributors",
  };
}

function vacancyPopupHtml(properties: Record<string, unknown>): string {
  const salary = properties.salary
    ? `<div class="map-popup-meta">${String(properties.salary)}</div>`
    : "";
  const link = properties.url
    ? `<div class="map-popup-src"><a href="${String(
        properties.url,
      )}" target="_blank" rel="noreferrer">Открыть на «Работа России»</a></div>`
    : "";
  return `
    <div class="map-popup">
      <strong>${String(properties.profession ?? "Вакансия")}</strong>
      <div class="map-popup-meta">${String(properties.employer ?? "")}</div>
      <div class="map-popup-meta">${String(properties.region ?? "")}</div>
      ${salary}
      ${link}
    </div>`;
}

const EMPTY_VACANCY_FC: VacancyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Слои, у вакансий/объектов которых приоритет над подложкой регионов: клик по
// ним не должен «проваливаться» в попап региона (issue #17).
const PRIORITY_LAYERS = [
  "obj-fill",
  "obj-line",
  "obj-points",
  "vac-clusters",
  "vac-points",
];

// Слои вакансий, которые включаются/выключаются тумблером «Вакансии».
const VACANCY_LAYERS = [
  "vac-heat",
  "vac-clusters",
  "vac-cluster-count",
  "vac-points",
];

function objectFeatureCollection(
  objects: TwinObject[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.map((item) => ({
      type: "Feature",
      properties: { id: item.id, name: item.name, html: objectPopupHtml(item) },
      geometry: item.geometry as GeoJSON.Geometry,
    })),
  };
}

function buildMapStyle(basemap: Basemap): StyleSpecification {
  const vacancyLayers: StyleSpecification["layers"] = [
    {
      id: "vac-heat",
      type: "heatmap",
      source: "vacancies-heat",
      maxzoom: 9,
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          0.6,
          9,
          2,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(33,102,172,0)",
          0.2,
          "#74add1",
          0.4,
          "#fee090",
          0.6,
          "#fdae61",
          0.8,
          "#f46d43",
          1,
          "#d73027",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 6, 9, 24],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 9, 0],
      },
    },
    {
      id: "vac-clusters",
      type: "circle",
      source: "vacancies",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          "#22c55e",
          10,
          "#eab308",
          30,
          "#ef4444",
        ],
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 30],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "vac-cluster-count",
      type: "symbol",
      source: "vacancies",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    },
    {
      id: "vac-points",
      type: "circle",
      source: "vacancies",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#7c3aed",
        "circle-radius": 7,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
  ];

  return {
    version: 8,
    // Шрифтовые глифы для подписей (счётчики кластеров) держим локально в
    // public/fonts, а не на внешнем CDN. Публичный сервер
    // fonts.openmaptiles.org перестал отдавать .pbf (возвращает HTML-страницу),
    // из-за чего воркер MapLibre падал с «Unimplemented type: 4» и обрывал
    // генерацию тайлов всего слоя вакансий — точки переставали появляться при
    // приближении к городу (issue #19). Локальные глифы работают офлайн и в
    // сетях с блокировками внешних CDN.
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      basemap: basemapSource(basemap),
      regions: { type: "geojson", data: "/regions-russia.geojson" },
      objects: {
        type: "geojson",
        data: EMPTY_VACANCY_FC,
      },
      vacancies: {
        type: "geojson",
        data: EMPTY_VACANCY_FC,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      },
      "vacancies-heat": { type: "geojson", data: EMPTY_VACANCY_FC },
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
      ...vacancyLayers,
    ],
  };
}

function MapPanel({
  objects,
  vacancies,
  showVacancies,
  basemap,
}: {
  objects: TwinObject[];
  vacancies: VacancyFeatureCollection;
  showVacancies: boolean;
  basemap: Basemap;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const cameraRef = useRef<{ center: [number, number]; zoom: number }>({
    center: [94, 64],
    zoom: 2.4,
  });

  // Последние данные держим в ref, чтобы обработчик `load` и эффекты
  // обновления источников всегда видели актуальные значения, а карта при этом
  // не пересоздавалась на каждое изменение (иначе инкрементальная догрузка
  // вакансий каждые 5 секунд приводила бы к полному перестроению карты).
  const objectsRef = useRef(objects);
  const vacanciesRef = useRef(vacancies);
  const showVacanciesRef = useRef(showVacancies);
  objectsRef.current = objects;
  vacanciesRef.current = vacancies;
  showVacanciesRef.current = showVacancies;

  // Создание карты — один раз на выбранную подложку.
  useEffect(() => {
    if (!ref.current) {
      return;
    }
    readyRef.current = false;
    const map = new maplibregl.Map({
      container: ref.current,
      style: buildMapStyle(basemap),
      center: cameraRef.current.center,
      zoom: cameraRef.current.zoom,
      interactive: true,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("moveend", () => {
      const center = map.getCenter();
      cameraRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
      };
    });

    const applyData = () => {
      const objectSource = map.getSource("objects") as
        | maplibregl.GeoJSONSource
        | undefined;
      objectSource?.setData(objectFeatureCollection(objectsRef.current));
      const vac = vacanciesRef.current;
      (
        map.getSource("vacancies") as maplibregl.GeoJSONSource | undefined
      )?.setData(vac);
      (
        map.getSource("vacancies-heat") as maplibregl.GeoJSONSource | undefined
      )?.setData(vac);
      const visibility = showVacanciesRef.current ? "visible" : "none";
      for (const layer of VACANCY_LAYERS) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(layer, "visibility", visibility);
        }
      }
    };

    map.on("load", () => {
      readyRef.current = true;
      applyData();
    });

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
    });

    for (const layer of ["obj-fill", "obj-line", "obj-points"]) {
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

    // Клик по кластеру вакансий — приближение и распад на маркеры зданий.
    map.on("click", "vac-clusters", (event) => {
      const feature = map.queryRenderedFeatures(event.point, {
        layers: ["vac-clusters"],
      })[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId === undefined) {
        return;
      }
      const source = map.getSource("vacancies") as maplibregl.GeoJSONSource;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geometry = feature.geometry as GeoJSON.Point;
        map.easeTo({
          center: geometry.coordinates as [number, number],
          zoom,
        });
      });
    });

    // Клик по точечной вакансии — карточка вакансии.
    map.on("click", "vac-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      popup
        .setLngLat(event.lngLat)
        .setHTML(vacancyPopupHtml(feature.properties ?? {}))
        .addTo(map);
    });
    for (const layer of ["vac-clusters", "vac-points"]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    // Попап региона показываем только если под курсором нет вакансии или
    // объекта: иначе клик по вакансии «проваливался» в регион и показывал
    // карточку субъекта вместо вакансии (issue #17).
    map.on("click", "regions-fill", (event) => {
      const onTop = map.queryRenderedFeatures(event.point, {
        layers: PRIORITY_LAYERS.filter((layer) => map.getLayer(layer)),
      });
      if (onTop.length > 0) {
        return;
      }
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

    return () => {
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [basemap]);

  // Обновление источников без пересоздания карты.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      return;
    }
    (map.getSource("objects") as maplibregl.GeoJSONSource | undefined)?.setData(
      objectFeatureCollection(objects),
    );
  }, [objects]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      return;
    }
    (
      map.getSource("vacancies") as maplibregl.GeoJSONSource | undefined
    )?.setData(vacancies);
    (
      map.getSource("vacancies-heat") as maplibregl.GeoJSONSource | undefined
    )?.setData(vacancies);
  }, [vacancies]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      return;
    }
    const visibility = showVacancies ? "visible" : "none";
    for (const layer of VACANCY_LAYERS) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", visibility);
      }
    }
  }, [showVacancies]);

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
          Открытый контур v0.1.4. Войдите как оператор платформы или другая роль
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

// Размер страницы и период инкрементальной догрузки вакансий (issue #17):
// слой наполняется порциями по 5000 записей каждые 5 секунд, пока не наберётся
// весь объём выгрузки.
const VACANCY_PAGE_SIZE = 5000;
const VACANCY_POLL_MS = 5000;

function MapView({ objects }: { objects: TwinObject[] }) {
  const [showVacancies, setShowVacancies] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [vacancies, setVacancies] =
    useState<VacancyFeatureCollection>(EMPTY_VACANCY_FC);
  const [professions, setProfessions] = useState<ProfessionCount[]>([]);
  const [meta, setMeta] = useState<VacancyMeta | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void fetchTopProfessions(12).then(setProfessions);
    void fetchVacanciesMeta().then(setMeta);
  }, []);

  // Инкрементальная догрузка: грузим вакансии страницами по 5000 и добавляем
  // к уже показанным каждые 5 секунд, пока не наберём весь объём выгрузки.
  // Раньше запрашивалась одна страница и на карту попадало максимум столько
  // вакансий, сколько было в демо-файле (107) — issue #17.
  useEffect(() => {
    if (!showVacancies) {
      setVacancies(EMPTY_VACANCY_FC);
      return;
    }
    const filter = selected ?? (search.trim() || undefined);
    let cancelled = false;
    let offset = 0;
    let features: VacancyFeatureCollection["features"] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    setVacancies(EMPTY_VACANCY_FC);

    const loadNextPage = async () => {
      const page = await fetchVacancies(filter, offset, VACANCY_PAGE_SIZE);
      if (cancelled) {
        return;
      }
      features = features.concat(page.features);
      offset += page.returned;
      setVacancies({ type: "FeatureCollection", features });
      if (page.returned > 0 && offset < page.total) {
        timer = setTimeout(() => void loadNextPage(), VACANCY_POLL_MS);
      }
    };

    void loadNextPage();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [showVacancies, selected, search]);

  const yandexAvailable = YANDEX_API_KEY.length > 0;
  const total = meta?.total ?? 0;
  const shown = vacancies.features.length;

  const pickProfession = (profession: string) => {
    setSearch("");
    setSelected((current) => (current === profession ? null : profession));
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSelected(null);
  };

  return (
    <section className="panel">
      <div className="section-title">
        <MapIcon size={18} />
        <h2>Карта открытого контура</h2>
      </div>
      <div className="map-layout">
        <div className="map-main">
          <MapPanel
            objects={objects}
            vacancies={vacancies}
            showVacancies={showVacancies}
            basemap={basemap}
          />
          <p className="panel-note">
            Подсвечены все субъекты РФ. Кликните по региону, объекту или
            вакансии, чтобы увидеть карточку. Слой вакансий «Работа России»
            можно включать и выключать; кластеры с цифрами при приближении
            распадаются на маркеры работодателей.
          </p>
        </div>
        <aside className="map-sidebar" aria-label="Слои и фильтры карты">
          <div className="layer-toggle">
            <div className="section-title compact">
              <Layers size={16} />
              <h3>Слои карты</h3>
            </div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={showVacancies}
                onChange={(event) => setShowVacancies(event.target.checked)}
              />
              <span>
                <Briefcase size={14} /> Вакансии «Работа России»
              </span>
            </label>
            <div className="basemap-row">
              <span>Подложка</span>
              <div className="basemap-buttons">
                <button
                  type="button"
                  className={basemap === "osm" ? "active" : ""}
                  onClick={() => setBasemap("osm")}
                >
                  OSM
                </button>
                <button
                  type="button"
                  className={basemap === "yandex" ? "active" : ""}
                  onClick={() => setBasemap("yandex")}
                  disabled={!yandexAvailable}
                  title={
                    yandexAvailable
                      ? "Яндекс Карты"
                      : "Добавьте VITE_YANDEX_API_KEY, чтобы включить Яндекс Карты"
                  }
                >
                  Яндекс
                </button>
              </div>
            </div>
            {!yandexAvailable && (
              <p className="sidebar-hint">
                Подложка Яндекс Карт включается переменной окружения{" "}
                <code>VITE_YANDEX_API_KEY</code>. По умолчанию используется OSM,
                а геокодер — бесплатный Nominatim (≤1 запрос/с).
              </p>
            )}
          </div>

          {showVacancies && (
            <div className="vacancy-panel">
              <form className="vacancy-search" onSubmit={submitSearch}>
                <Search size={14} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск специалиста..."
                  aria-label="Поиск профессии"
                />
              </form>
              <div className="vacancy-count">
                Показано <strong>{shown}</strong>
                {total ? ` из ${total}` : ""} вакансий
                {selected ? ` · «${selected}»` : ""}
                {(selected || search) && (
                  <button
                    type="button"
                    className="clear-filter"
                    onClick={() => {
                      setSelected(null);
                      setSearch("");
                    }}
                  >
                    сбросить
                  </button>
                )}
              </div>
              <div className="profession-list" aria-label="Топ профессий">
                {professions.map((item) => {
                  const max = professions[0]?.count || 1;
                  const width = Math.round((item.count / max) * 100);
                  const active = selected === item.profession;
                  return (
                    <button
                      key={item.profession}
                      type="button"
                      className={`profession-row${active ? " active" : ""}`}
                      onClick={() => pickProfession(item.profession)}
                    >
                      <span
                        className="profession-bar"
                        style={{ width: `${width}%` }}
                      />
                      <span className="profession-name">{item.profession}</span>
                      <span className="profession-count">{item.count}</span>
                    </button>
                  );
                })}
              </div>
              {meta && (
                <p className="sidebar-hint">
                  Источник: {meta.source}. Обновление каждые{" "}
                  {(meta.refresh_interval_hours / 24).toFixed(1)} суток,
                  инкрементально по <code>{meta.incremental_param}</code>.
                  Геокодер: {meta.geocoder}.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
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

function CatalogView({
  datasets,
  session,
}: {
  datasets: DatasetPassport[];
  session: Session;
}) {
  const [domain, setDomain] = useState<string>("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOperator = session.role === "operator";
  const domains = useMemo(
    () => Array.from(new Set(datasets.map((dataset) => dataset.domain))).sort(),
    [datasets],
  );
  const filtered = domain
    ? datasets.filter((dataset) => dataset.domain === domain)
    : datasets;

  const download = async (datasetId: string) => {
    setDownloading(datasetId);
    setError(null);
    try {
      await downloadDatasetCsv(session, datasetId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось скачать данные.",
      );
    } finally {
      setDownloading(null);
    }
  };

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
      {isOperator ? (
        <p className="panel-note">
          Режим оператора платформы: доступна выгрузка сырых данных (CSV) по
          каждому датасету.
        </p>
      ) : (
        <p className="panel-note">
          Выгрузка сырых данных (CSV) доступна только операторам платформы.
        </p>
      )}
      {error && <p className="login-error">{error}</p>}
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
              {isOperator && <th>Сырые данные</th>}
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
                {isOperator && (
                  <td>
                    <button
                      type="button"
                      className="download-button"
                      onClick={() => void download(dataset.id)}
                      disabled={downloading === dataset.id}
                    >
                      <Download size={14} />
                      {downloading === dataset.id ? "..." : "CSV"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportsView({
  run,
  metrics,
}: {
  run: ScenarioRun | null;
  metrics: {
    datasets: number;
    domains: number;
    scenarios: number;
    objects: number;
  };
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <FileDown size={18} />
        <h2>Отчёты</h2>
      </div>
      <section className="metrics" aria-label="Метрики готовности">
        <article>
          <span>датасеты</span>
          <strong>{metrics.datasets || "..."}</strong>
        </article>
        <article>
          <span>домены</span>
          <strong>{metrics.domains || "..."}</strong>
        </article>
        <article>
          <span>сценарии</span>
          <strong>{metrics.scenarios || "..."}</strong>
        </article>
        <article>
          <span>объекты карты</span>
          <strong>{metrics.objects || "..."}</strong>
        </article>
      </section>
      {run ? (
        <RunResultView run={run} />
      ) : (
        <p className="panel-note">
          Запустите или откройте сценарий на вкладке «Сценарии», чтобы здесь
          появился отчёт с источниками и версиями данных. Метрики готовности
          открытого контура показаны выше.
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
            <h1>Цифровой двойник России v0.1.4</h1>
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

        {view === "map" && <MapView objects={objects} />}
        {view === "scenarios" && (
          <ScenariosView
            session={session}
            scenarios={scenarios}
            onRun={setLastRun}
          />
        )}
        {view === "catalog" && (
          <CatalogView datasets={datasets} session={session} />
        )}
        {view === "reports" && (
          <ReportsView
            run={lastRun}
            metrics={{
              datasets: datasets.length,
              domains: domains.length,
              scenarios: scenarios.length,
              objects: objects.length,
            }}
          />
        )}
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
