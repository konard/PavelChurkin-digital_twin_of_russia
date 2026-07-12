import "maplibre-gl/dist/maplibre-gl.css";

import {
  Archive,
  BarChart3,
  Briefcase,
  CalendarClock,
  ChevronDown,
  Download,
  FileDown,
  Home,
  KeyRound,
  Layers,
  LogOut,
  Map as MapIcon,
  Play,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import maplibregl, {
  type SourceSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  createApiKey,
  downloadDatasetCsv,
  exportRunUrl,
  fetchConfig,
  fetchDatasets,
  fetchDemoRun,
  fetchObjects,
  fetchRoles,
  fetchScenarios,
  login,
  runScenario,
} from "./api";
import {
  buildVacancyReport,
  parseDate,
  vacancyReportToMarkdown,
  type VacancyReport,
} from "./reports";
import {
  MAX_LOAD_COUNT,
  PAGE_SIZE,
  useVacancies,
  type VacanciesState,
} from "./useVacancies";
import type {
  ApiKeyResponse,
  AppConfig,
  DatasetPassport,
  ProfessionCount,
  RoleInfo,
  Scenario,
  ScenarioRun,
  Session,
  TwinObject,
  VacancyFeatureCollection,
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

// Ключ Яндекса из сборки (Vite запекает VITE_* при build). Issue #21: это
// ненадёжно — ключ, заданный после сборки, в бандл не попадает, и кнопка
// остаётся неактивной. Поэтому основной источник ключа — рантайм-эндпоинт
// /api/v1/config; build-time значение остаётся лишь запасным.
const BUILD_TIME_YANDEX_KEY = import.meta.env.VITE_YANDEX_API_KEY ?? "";

function basemapSource(
  basemap: Basemap,
  yandexKey: string,
): SourceSpecification {
  if (basemap === "yandex" && yandexKey) {
    // Подключение Яндекс Карт включается только при наличии API-ключа.
    // Лимиты бесплатного плана соблюдаются на стороне геокодера (см. docs).
    return {
      type: "raster",
      tiles: [
        `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&l=map&lang=ru_RU&apikey=${yandexKey}`,
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

// Координаты точки вакансии в виде "широта, долгота" (геометрия хранит
// [lon, lat]). ``null`` при отсутствии координат — таких вакансий в выдаче быть
// не должно (issue #23, п. 9), но проверка защищает от битых данных.
function featureCoords(
  feature: VacancyFeatureCollection["features"][number],
): [number, number] | null {
  const coordinates = (feature.geometry?.coordinates ?? []) as number[];
  const [lon, lat] = coordinates;
  if (typeof lon !== "number" || typeof lat !== "number") {
    return null;
  }
  return [lon, lat];
}

/**
 * Модальное окно со списком всех вакансий выбранного специалиста (issue #23).
 *
 * Список строится из уже подгруженного кэша — повторного запроса к API нет
 * (issue #23, пп. 1/2). Клик по координатам переносит на карту и приближает к
 * точке максимально (issue #23, п. 3). Показывается дата последней загрузки.
 */
function VacancyListModal({
  profession,
  features,
  loadedAt,
  onClose,
  onFocusPoint,
}: {
  profession: string;
  features: VacancyFeatureCollection["features"];
  loadedAt: Date | null;
  onClose: () => void;
  onFocusPoint: (point: [number, number]) => void;
}) {
  return (
    <div
      className="vacancy-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="vacancy-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Вакансии: ${profession}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="vacancy-modal-head">
          <div>
            <h3>Вакансии: {profession}</h3>
            <p className="vacancy-modal-meta">
              Всего вакансий: <strong>{features.length}</strong>
              {loadedAt
                ? ` · данные загружены ${loadedAt.toLocaleString("ru-RU")}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="vacancy-modal-close"
            onClick={onClose}
            aria-label="Закрыть список"
          >
            <X size={18} />
          </button>
        </header>
        {features.length === 0 ? (
          <p className="vacancy-modal-empty">
            Вакансии с координатами не найдены.
          </p>
        ) : (
          <div className="vacancy-modal-scroll">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Работодатель</th>
                  <th>Регион</th>
                  <th>Зарплата</th>
                  <th>Координаты</th>
                  <th>Ссылка</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature, index) => {
                  const props = feature.properties;
                  const point = featureCoords(feature);
                  return (
                    <tr key={props.id}>
                      <td>{index + 1}</td>
                      <td>{props.employer || "—"}</td>
                      <td>{props.region || "—"}</td>
                      <td>{props.salary || "—"}</td>
                      <td>
                        {point ? (
                          <button
                            type="button"
                            className="vacancy-coord-link"
                            title="Показать на карте и приблизить к точке"
                            onClick={() => onFocusPoint(point)}
                          >
                            {point[1].toFixed(4)}, {point[0].toFixed(4)}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {props.url ? (
                          <a href={props.url} target="_blank" rel="noreferrer">
                            открыть
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

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

function buildMapStyle(
  basemap: Basemap,
  yandexKey: string,
): StyleSpecification {
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
      basemap: basemapSource(basemap, yandexKey),
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

// Обзор всей России — исходное положение камеры и цель кнопки «домой»
// (issue #23, п. 4).
const HOME_CENTER: [number, number] = [94, 64];
const HOME_ZOOM = 2.4;
// Максимальное приближение при переходе к конкретной вакансии из списка
// (issue #23, п. 3).
const FOCUS_ZOOM = 16;

function MapPanel({
  objects,
  vacancies,
  showVacancies,
  basemap,
  yandexKey,
  focusPoint,
}: {
  objects: TwinObject[];
  vacancies: VacancyFeatureCollection;
  showVacancies: boolean;
  basemap: Basemap;
  yandexKey: string;
  focusPoint: { point: [number, number]; nonce: number } | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const cameraRef = useRef<{ center: [number, number]; zoom: number }>({
    center: HOME_CENTER,
    zoom: HOME_ZOOM,
  });

  // Последние данные держим в ref, чтобы обработчик `load` и эффекты
  // обновления источников всегда видели актуальные значения, а карта при этом
  // не пересоздавалась на каждое обновление слоя вакансий (иначе перезагрузка
  // слоя приводила бы к полному перестроению карты).
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
      style: buildMapStyle(basemap, yandexKey),
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
  }, [basemap, yandexKey]);

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

  // Переход к конкретной вакансии из списка: карта приближается к точке
  // максимально (issue #23, п. 3). ``nonce`` меняется на каждый клик, чтобы
  // повторный выбор той же точки тоже срабатывал.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) {
      return;
    }
    map.flyTo({ center: focusPoint.point, zoom: FOCUS_ZOOM, essential: true });
  }, [focusPoint]);

  const goHome = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.easeTo({ center: HOME_CENTER, zoom: HOME_ZOOM, essential: true });
  };

  return (
    <div className="map-canvas-wrap">
      <div
        ref={ref}
        className="map-canvas"
        aria-label="Карта регионов России"
      />
      <button
        type="button"
        className="map-home-button"
        onClick={goHome}
        title="Показать всю Россию"
        aria-label="Показать всю Россию"
      >
        <Home size={16} />
      </button>
    </div>
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
          Открытый контур v0.1.7. Войдите как оператор платформы или другая роль
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

// Сколько профессий показывать в сайдбаре до раскрытия полного списка (#19).
const PROFESSION_PREVIEW = 10;

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return PAGE_SIZE;
  }
  return Math.max(1, Math.min(Math.round(value), max));
}

// Профессии считаем на клиенте из уже подгруженного кэша, чтобы фильтры и
// список не опрашивали API повторно (issue #23, пп. 1/2).
function countProfessions(
  features: VacancyFeatureCollection["features"],
): ProfessionCount[] {
  const counter = new Map<string, number>();
  for (const feature of features) {
    const name = feature.properties.profession || "—";
    counter.set(name, (counter.get(name) ?? 0) + 1);
  }
  return Array.from(counter.entries())
    .map(([profession, count]) => ({ profession, count }))
    .sort((a, b) => b.count - a.count);
}

function MapView({
  objects,
  session,
  vacancies,
}: {
  objects: TwinObject[];
  session: Session;
  // Кэш подгруженных вакансий поднят на уровень рабочего пространства
  // (issue #25, п. 2): переживает переключение разделов.
  vacancies: VacanciesState;
}) {
  // Гость получает одну страницу открытого API (issue #21); остальным ролям
  // доступна прогрессивная подгрузка указанного числа вакансий.
  const isGuest = session.role === "guest";
  const {
    allVacancies,
    meta,
    loadedProgress,
    loading,
    error,
    loadedAt,
    exhausted,
    runLoad,
  } = vacancies;
  const [showVacancies, setShowVacancies] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [salaryMin, setSalaryMin] = useState(0);
  const [showAllProfessions, setShowAllProfessions] = useState(false);
  // Фильтр по дате (issue #25, п. 1): показывать вакансии, у которых дата
  // создания или изменения не старше указанного числа дней. ``0`` — фильтр
  // выключен.
  const [dateField, setDateField] = useState<"created_at" | "modified_at">(
    "modified_at",
  );
  const [dateDays, setDateDays] = useState(0);
  // Введённое в поле число и фактически запрошенное (цель прогрузки).
  const [countInput, setCountInput] = useState(PAGE_SIZE);
  // Модальное окно списка вакансий выбранного специалиста (issue #23).
  const [listProfession, setListProfession] = useState<string | null>(null);
  // Точка, к которой карта приближается по клику из списка (issue #23, п. 3).
  const [focusPoint, setFocusPoint] = useState<{
    point: [number, number];
    nonce: number;
  } | null>(null);
  const focusNonceRef = useRef(0);

  const total = meta?.total ?? 0;
  // Верхний предел поля ввода равен общему числу вакансий на «Работа России»
  // (issue #23, п. 11). Если объём ещё не известен — временный предохранитель.
  const maxLoad = total || MAX_LOAD_COUNT;

  useEffect(() => {
    // Ключ Яндекса берётся из рантайм-конфигурации, поэтому работает без
    // пересборки фронтенда (issue #21).
    void fetchConfig().then(setConfig);
  }, []);

  const yandexKey = config?.yandex_api_key || BUILD_TIME_YANDEX_KEY;
  const yandexAvailable = yandexKey.length > 0;

  // Профессии считаем из кэша — без отдельного запроса к API (issue #23).
  const professions = useMemo(
    () => countProfessions(allVacancies.features),
    [allVacancies],
  );

  // Максимальная зарплата в кэше — верхняя граница ползунка фильтра.
  const salaryCap = useMemo(() => {
    let max = 0;
    for (const feature of allVacancies.features) {
      const value = feature.properties.salary_value ?? 0;
      if (value > max) {
        max = value;
      }
    }
    // Округляем вверх до 10 000, чтобы ползунок имел «круглый» предел.
    return Math.max(10000, Math.ceil(max / 10000) * 10000);
  }, [allVacancies]);

  // Порог даты в миллисекундах: вакансии старше него скрываются (issue #25).
  // ``null`` — фильтр по дате выключен.
  const dateThreshold = useMemo(() => {
    if (dateDays <= 0) {
      return null;
    }
    return Date.now() - dateDays * 24 * 60 * 60 * 1000;
  }, [dateDays]);

  // Общий предикат по зарплате и дате — применяется и на карте, и в списке
  // выбранного специалиста, чтобы фильтры совпадали (issue #25).
  const matchesSalaryAndDate = useMemo(() => {
    return (feature: VacancyFeatureCollection["features"][number]): boolean => {
      const props = feature.properties;
      if (salaryMin > 0 && (props.salary_value ?? 0) < salaryMin) {
        return false;
      }
      if (dateThreshold !== null) {
        const ts = parseDate(props[dateField]);
        if (ts === null || ts < dateThreshold) {
          return false;
        }
      }
      return true;
    };
  }, [salaryMin, dateThreshold, dateField]);

  // Отображаемый слой строится из кэша клиентскими фильтрами (issue #23/#25):
  // профессия/поиск + зарплата + интервал по дате. Повторных запросов к API
  // нет — при смене любого фильтра список обновляется.
  const displayed = useMemo<VacancyFeatureCollection>(() => {
    const needle = (selected ?? search).trim().toLowerCase();
    const features = allVacancies.features.filter((feature) => {
      if (
        needle &&
        !feature.properties.profession.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return matchesSalaryAndDate(feature);
    });
    return { type: "FeatureCollection", features };
  }, [allVacancies, selected, search, matchesSalaryAndDate]);

  // Вакансии выбранного специалиста для модального списка (из кэша, с учётом
  // порога зарплаты и интервала по дате — как на карте).
  const listFeatures = useMemo(() => {
    if (!listProfession) {
      return [];
    }
    return allVacancies.features.filter(
      (feature) =>
        feature.properties.profession === listProfession &&
        matchesSalaryAndDate(feature),
    );
  }, [allVacancies, listProfession, matchesSalaryAndDate]);

  const shown = displayed.features.length;
  const loadedCount = allVacancies.features.length;
  const visibleProfessions = showAllProfessions
    ? professions
    : professions.slice(0, PROFESSION_PREVIEW);

  const pickProfession = (profession: string) => {
    setSearch("");
    setSelected((current) => (current === profession ? null : profession));
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSelected(null);
  };

  const submitCount = (event: React.FormEvent) => {
    event.preventDefault();
    void runLoad(clampCount(countInput, maxLoad));
  };

  const focusOnPoint = (point: [number, number]) => {
    focusNonceRef.current += 1;
    setFocusPoint({ point, nonce: focusNonceRef.current });
    // Закрываем список — переносим внимание на карту (issue #23, п. 3).
    setListProfession(null);
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
            vacancies={displayed}
            showVacancies={showVacancies}
            basemap={basemap}
            yandexKey={yandexKey}
            focusPoint={focusPoint}
          />
          <p className="panel-note">
            Подсвечены все субъекты РФ. Кликните по региону, объекту или
            вакансии, чтобы увидеть карточку. Кнопкой «домой» на карте можно
            вернуться к обзору всей России. Слой вакансий «Работа России» можно
            включать и выключать; кластеры с цифрами при приближении распадаются
            на маркеры работодателей.
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
                      : "Задайте YANDEX_API_KEY на бэкенде, чтобы включить Яндекс Карты"
                  }
                >
                  Яндекс
                </button>
              </div>
            </div>
            {!yandexAvailable && (
              <p className="sidebar-hint">
                Подложка Яндекс Карт включается переменной окружения{" "}
                <code>YANDEX_API_KEY</code> на бэкенде — ключ отдаётся через{" "}
                <code>/api/v1/config</code> и применяется без пересборки
                фронтенда (issue #21). По умолчанию используется OSM, а геокодер
                — бесплатный Nominatim (≤1 запрос/с).
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
              <div className="vacancy-salary">
                <label htmlFor="vacancy-salary-min">
                  Зарплата не ниже:{" "}
                  <strong>{salaryMin.toLocaleString("ru-RU")} ₽</strong>
                </label>
                <input
                  id="vacancy-salary-min"
                  type="range"
                  min={0}
                  max={salaryCap}
                  step={10000}
                  value={Math.min(salaryMin, salaryCap)}
                  onChange={(event) => setSalaryMin(Number(event.target.value))}
                  aria-label="Минимальная зарплата"
                />
                {salaryMin > 0 && (
                  <button
                    type="button"
                    className="clear-filter"
                    onClick={() => setSalaryMin(0)}
                  >
                    сбросить порог
                  </button>
                )}
              </div>
              <div className="vacancy-date">
                <label className="vacancy-date-title">
                  <CalendarClock size={14} /> Фильтр по дате
                </label>
                <div className="vacancy-date-row">
                  <select
                    value={dateField}
                    onChange={(event) =>
                      setDateField(
                        event.target.value as "created_at" | "modified_at",
                      )
                    }
                    aria-label="Поле даты для фильтра"
                  >
                    <option value="modified_at">по дате изменения</option>
                    <option value="created_at">по дате создания</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={dateDays}
                    onChange={(event) =>
                      setDateDays(Math.max(0, Number(event.target.value)))
                    }
                    aria-label="Интервал в днях"
                  />
                  <span>дней</span>
                </div>
                <p className="sidebar-hint">
                  {dateDays > 0
                    ? `Показаны вакансии не старше ${dateDays} дн. ` +
                      `(${dateField === "created_at" ? "создание" : "изменение"}).`
                    : "0 — без ограничения по дате."}
                </p>
                {dateDays > 0 && (
                  <button
                    type="button"
                    className="clear-filter"
                    onClick={() => setDateDays(0)}
                  >
                    сбросить дату
                  </button>
                )}
              </div>
              {isGuest ? (
                <p className="sidebar-hint">
                  Гостевой режим: загружена одна страница открытого API «Работа
                  России» ({meta?.guest_limit ?? PAGE_SIZE} вакансий). Войдите
                  под ролью, чтобы подгрузить больше (issue #21).
                </p>
              ) : (
                <form className="vacancy-load" onSubmit={submitCount}>
                  <label htmlFor="vacancy-load-count">
                    Загрузить вакансий (до {maxLoad.toLocaleString("ru-RU")})
                  </label>
                  <div className="vacancy-load-row">
                    <input
                      id="vacancy-load-count"
                      type="number"
                      min={1}
                      max={maxLoad}
                      step={100}
                      value={countInput}
                      onChange={(event) =>
                        setCountInput(Number(event.target.value))
                      }
                      aria-label="Число вакансий для загрузки"
                    />
                    <button type="submit" disabled={loading}>
                      {loading ? "Загрузка…" : "Загрузить"}
                    </button>
                  </div>
                </form>
              )}
              {error && (
                <p className="vacancy-error" role="alert">
                  Ошибка загрузки: {error}
                </p>
              )}
              <div className="vacancy-count">
                {loading ? (
                  <>
                    Загрузка… подгружено <strong>{loadedProgress}</strong>
                    {total ? ` из ${total.toLocaleString("ru-RU")}` : ""}
                  </>
                ) : (
                  <>
                    Показано <strong>{shown}</strong>
                    {total ? ` из ${total.toLocaleString("ru-RU")}` : ""}{" "}
                    вакансий
                    {loadedCount ? ` · подгружено ${loadedCount}` : ""}
                    {exhausted && loadedCount ? " (все доступные)" : ""}
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
                  </>
                )}
              </div>
              {loadedAt && (
                <p className="vacancy-loaded-at">
                  Данные загружены: {loadedAt.toLocaleString("ru-RU")}
                </p>
              )}
              <div className="profession-list" aria-label="Список специалистов">
                {visibleProfessions.map((item) => {
                  const max = professions[0]?.count || 1;
                  const width = Math.round((item.count / max) * 100);
                  const active = selected === item.profession;
                  return (
                    <div
                      key={item.profession}
                      className={`profession-row${active ? " active" : ""}`}
                    >
                      <button
                        type="button"
                        className="profession-pick"
                        onClick={() => pickProfession(item.profession)}
                        title="Показать на карте только этого специалиста"
                        aria-pressed={active}
                      >
                        <span
                          className="profession-bar"
                          style={{ width: `${width}%` }}
                        />
                        <span className="profession-name">
                          {item.profession}
                        </span>
                        <span className="profession-count">{item.count}</span>
                      </button>
                      <button
                        type="button"
                        className="profession-all"
                        onClick={() => setListProfession(item.profession)}
                        title="Открыть полный список вакансий этого специалиста"
                      >
                        все
                      </button>
                    </div>
                  );
                })}
                {professions.length > PROFESSION_PREVIEW && (
                  <button
                    type="button"
                    className="profession-expand"
                    onClick={() => setShowAllProfessions((value) => !value)}
                  >
                    {showAllProfessions
                      ? "Свернуть список"
                      : `Показать все специальности (${professions.length})`}
                  </button>
                )}
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
      {listProfession && (
        <VacancyListModal
          profession={listProfession}
          features={listFeatures}
          loadedAt={loadedAt}
          onClose={() => setListProfession(null)}
          onFocusPoint={focusOnPoint}
        />
      )}
    </section>
  );
}

function ScenariosView({
  session,
  scenarios,
  onRun,
  onOpenReports,
}: {
  session: Session;
  scenarios: Scenario[];
  onRun: (run: ScenarioRun) => void;
  // Переход к разделу отчётов (issue #25): генерация отчётов вынесена вместе со
  // сценариями, но открывается в модуле «Отчёты».
  onOpenReports: () => void;
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
        {/* Генерация отчётов вынесена вместе со сценариями (issue #25): ниже
            демо-сценариев отдельной карточкой — анализ вакансий «Работа
            России», который открывается в разделе «Отчёты». */}
        <article className="scenario-card scenario-card-report">
          <div>
            <strong>Анализ вакансий «Работа России»</strong>
            <span>
              Топ востребованных и оплачиваемых специальностей, городов и
              вакансий по датам создания и изменения. Число позиций в топе
              настраивается.
            </span>
            <small>отчёт · issue #25</small>
          </div>
          <button type="button" onClick={onOpenReports}>
            <BarChart3 size={15} /> Сформировать отчёт
          </button>
        </article>
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

// Скачать текст как файл (issue #25: отчёты должны быть скачиваемыми).
function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Раскрывающийся модуль отчёта (issue #25): заголовок-кнопка сворачивает и
// разворачивает содержимое, справа — необязательная кнопка скачивания.
function ReportModule({
  title,
  icon,
  subtitle,
  defaultOpen = false,
  onDownload,
  children,
}: {
  title: string;
  icon: ReactNode;
  subtitle?: string;
  defaultOpen?: boolean;
  onDownload?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`report-module${open ? " open" : ""}`}>
      <header className="report-module-head">
        <button
          type="button"
          className="report-module-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ChevronDown size={16} className="report-module-chevron" />
          {icon}
          <span className="report-module-title">{title}</span>
          {subtitle && (
            <span className="report-module-subtitle">{subtitle}</span>
          )}
        </button>
        {onDownload && (
          <button
            type="button"
            className="report-module-download"
            onClick={onDownload}
            title="Скачать отчёт"
          >
            <Download size={14} /> Скачать
          </button>
        )}
      </header>
      {open && <div className="report-module-body">{children}</div>}
    </section>
  );
}

function ReportRankedList({ rows }: { rows: string[] }) {
  if (rows.length === 0) {
    return <p className="panel-note">Нет данных — подгрузите вакансии.</p>;
  }
  return (
    <ol className="report-ranked">
      {rows.map((row, index) => (
        <li key={`${index}-${row}`}>{row}</li>
      ))}
    </ol>
  );
}

const money = (value: number): string => `${value.toLocaleString("ru-RU")} ₽`;

// Кликабельная метрика готовности (issue #25): по нажатию на число
// раскрывается список значений.
function ReportMetric({ label, items }: { label: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`report-metric${open ? " open" : ""}`}>
      <span>{label}</span>
      <button
        type="button"
        className="report-metric-value"
        onClick={() => setOpen((value) => !value)}
        disabled={items.length === 0}
        aria-expanded={open}
        title="Показать список"
      >
        {items.length || "..."}
      </button>
      {open && items.length > 0 && (
        <ul className="report-metric-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function VacancyAnalysisReport({
  report,
  loadedAt,
  onDownload,
}: {
  report: VacancyReport;
  loadedAt: Date | null;
  onDownload: () => void;
}) {
  return (
    <ReportModule
      title="Анализ вакансий «Работа России»"
      icon={<BarChart3 size={16} />}
      subtitle={`${report.totalAnalyzed} вак.`}
      defaultOpen
      onDownload={onDownload}
    >
      <p className="report-meta">
        Проанализировано вакансий: <strong>{report.totalAnalyzed}</strong> (с
        зарплатой: {report.withSalary}). Размер топа: {report.topN}.
        {loadedAt
          ? ` Данные загружены ${loadedAt.toLocaleString("ru-RU")}.`
          : ""}
      </p>
      <div className="report-grid">
        <div className="report-block">
          <h4>Топ востребованных специальностей</h4>
          <ReportRankedList
            rows={report.topProfessions.map(
              (item) => `${item.name} — ${item.count} вак.`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Топ самых оплачиваемых вакансий</h4>
          <ReportRankedList
            rows={report.topPaid.map(
              (item) =>
                `${item.profession} (${item.employer}, ${item.region}) — ${money(item.salary)}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Топ оплачиваемых среди востребованных</h4>
          <ReportRankedList
            rows={report.topPaidAmongDemand.map(
              (item) =>
                `${item.profession} — ${money(item.avgSalary)} (${item.count} вак.)`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Топ городов по числу вакансий</h4>
          <ReportRankedList
            rows={report.topCitiesByCount.map(
              (item) => `${item.name} — ${item.count} вак.`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Топ городов по средней зарплате</h4>
          <ReportRankedList
            rows={report.topCitiesBySalary.map(
              (item) => `${item.name} — ${money(item.value)}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Топ городов по зарплате востребованных</h4>
          <ReportRankedList
            rows={report.topCitiesByDemandPaid.map(
              (item) => `${item.name} — ${money(item.value)}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Самые давние по дате создания</h4>
          <ReportRankedList
            rows={report.oldestCreated.map(
              (item) => `${item.profession} (${item.region}) — ${item.date}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Недавние по дате создания</h4>
          <ReportRankedList
            rows={report.newestCreated.map(
              (item) => `${item.profession} (${item.region}) — ${item.date}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Самые давние по дате изменения</h4>
          <ReportRankedList
            rows={report.oldestModified.map(
              (item) => `${item.profession} (${item.region}) — ${item.date}`,
            )}
          />
        </div>
        <div className="report-block">
          <h4>Недавние по дате изменения</h4>
          <ReportRankedList
            rows={report.newestModified.map(
              (item) => `${item.profession} (${item.region}) — ${item.date}`,
            )}
          />
        </div>
      </div>
    </ReportModule>
  );
}

function ReportsView({
  run,
  datasets,
  scenarios,
  objects,
  vacancies,
}: {
  run: ScenarioRun | null;
  datasets: DatasetPassport[];
  scenarios: Scenario[];
  objects: TwinObject[];
  vacancies: VacanciesState;
}) {
  // Настраиваемый размер топа для отчёта «Анализ вакансий» (issue #25).
  const [topN, setTopN] = useState(20);
  const { allVacancies, loadedAt } = vacancies;

  const domains = useMemo(
    () => Array.from(new Set(datasets.map((dataset) => dataset.domain))).sort(),
    [datasets],
  );

  const report = useMemo(
    () => buildVacancyReport(allVacancies.features, topN),
    [allVacancies, topN],
  );

  const downloadReport = () => {
    downloadTextFile(
      "vacancy-analysis.md",
      vacancyReportToMarkdown(report),
      "text/markdown;charset=utf-8",
    );
  };

  return (
    <section className="panel">
      <div className="section-title">
        <FileDown size={18} />
        <h2>Отчёты</h2>
      </div>

      <ReportModule
        title="Метрики готовности открытого контура"
        icon={<BarChart3 size={16} />}
        defaultOpen
      >
        <p className="panel-note">
          Нажмите на число, чтобы раскрыть список (issue #25).
        </p>
        <section className="metrics" aria-label="Метрики готовности">
          <ReportMetric
            label="датасеты"
            items={datasets.map((dataset) => dataset.title)}
          />
          <ReportMetric label="домены" items={domains} />
          <ReportMetric
            label="сценарии"
            items={scenarios.map((scenario) => scenario.title)}
          />
          <ReportMetric
            label="объекты карты"
            items={objects.map((object) => object.name)}
          />
        </section>
      </ReportModule>

      <div className="report-topn">
        <label htmlFor="report-topn">
          Число позиций в топе: <strong>{topN}</strong>
        </label>
        <input
          id="report-topn"
          type="number"
          min={1}
          max={100}
          step={1}
          value={topN}
          onChange={(event) =>
            setTopN(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
          }
          aria-label="Число позиций в топе"
        />
      </div>

      <VacancyAnalysisReport
        report={report}
        loadedAt={loadedAt}
        onDownload={downloadReport}
      />

      <ReportModule
        title="Отчёт по сценарию"
        icon={<FileDown size={16} />}
        subtitle={run ? run.scenario_id : "нет запуска"}
      >
        {run ? (
          <RunResultView run={run} />
        ) : (
          <p className="panel-note">
            Запустите или откройте сценарий на вкладке «Сценарии», чтобы здесь
            появился отчёт с источниками и версиями данных.
          </p>
        )}
      </ReportModule>
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
  // Кэш вакансий поднят на уровень рабочего пространства (issue #25, п. 2):
  // результаты опроса API сохраняются при переключении разделов.
  const vacancies = useVacancies(session);

  useEffect(() => {
    void fetchDatasets().then(setDatasets);
    void fetchScenarios().then(setScenarios);
    void fetchObjects().then(setObjects);
    void fetchDemoRun("regional-passport").then(setLastRun);
  }, []);

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
            <h1>Цифровой двойник России v0.1.7</h1>
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

        {view === "map" && (
          <MapView objects={objects} session={session} vacancies={vacancies} />
        )}
        {view === "scenarios" && (
          <ScenariosView
            session={session}
            scenarios={scenarios}
            onRun={setLastRun}
            onOpenReports={() => setView("reports")}
          />
        )}
        {view === "catalog" && (
          <CatalogView datasets={datasets} session={session} />
        )}
        {view === "reports" && (
          <ReportsView
            run={lastRun}
            datasets={datasets}
            scenarios={scenarios}
            objects={objects}
            vacancies={vacancies}
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
