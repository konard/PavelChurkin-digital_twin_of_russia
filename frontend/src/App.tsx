import "maplibre-gl/dist/maplibre-gl.css";

import {
  Activity,
  Archive,
  FileDown,
  KeyRound,
  Layers,
  Map,
  Play,
  ShieldCheck,
} from "lucide-react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchDatasets, fetchDemoRun, fetchScenarios } from "./api";
import type { DatasetPassport, Scenario, ScenarioRun } from "./types";

const qualityLabels: Record<string, string> = {
  verified: "проверено",
  aggregated: "агрегировано",
  draft: "черновик",
  outdated: "устарело",
};

function MapPanel() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const style: StyleSpecification = {
      version: 8,
      sources: {
        pilot: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { name: "Агрегат открытого контура" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [37.33, 55.58],
                      [37.9, 55.58],
                      [37.9, 55.95],
                      [37.33, 55.95],
                      [37.33, 55.58],
                    ],
                  ],
                },
              },
              {
                type: "Feature",
                properties: { name: "Кластер трудовых ресурсов" },
                geometry: { type: "Point", coordinates: [37.62, 55.75] },
              },
              {
                type: "Feature",
                properties: { name: "Сигнал риска" },
                geometry: { type: "Point", coordinates: [37.78, 55.68] },
              },
            ],
          },
        },
      },
      layers: [
        {
          id: "pilot-fill",
          type: "fill",
          source: "pilot",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#c7d2fe", "fill-opacity": 0.46 },
        },
        {
          id: "pilot-outline",
          type: "line",
          source: "pilot",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "line-color": "#1d4ed8", "line-width": 2 },
        },
        {
          id: "pilot-points",
          type: "circle",
          source: "pilot",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": [
              "match",
              ["get", "name"],
              "Сигнал риска",
              "#ea580c",
              "#0f766e",
            ],
            "circle-radius": 8,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        },
      ],
    };

    const map = new maplibregl.Map({
      container: ref.current,
      style,
      center: [37.62, 55.75],
      zoom: 8.3,
      interactive: true,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    return () => map.remove();
  }, []);

  return <div ref={ref} className="map-canvas" aria-label="Карта пилотного региона" />;
}

function App() {
  const [datasets, setDatasets] = useState<DatasetPassport[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [run, setRun] = useState<ScenarioRun | null>(null);

  useEffect(() => {
    void fetchDatasets().then(setDatasets);
    void fetchScenarios().then(setScenarios);
    void fetchDemoRun().then(setRun);
  }, []);

  const domains = useMemo(
    () => Array.from(new Set(datasets.map((dataset) => dataset.domain))).sort(),
    [datasets],
  );
  const sourceCount = run?.result.sources.length ?? 0;

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Модули">
        <div className="brand">DTR</div>
        <button aria-label="Карта">
          <Map size={19} />
        </button>
        <button aria-label="Сценарии">
          <Play size={19} />
        </button>
        <button aria-label="Каталог">
          <Archive size={19} />
        </button>
        <button aria-label="Отчёты">
          <FileDown size={19} />
        </button>
        <button aria-label="Доступ">
          <KeyRound size={19} />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Цифровой двойник России v0.1</h1>
            <p>
              Открытый контур: каталоги, сценарии, отчёты и аудит на
              демо-данных.
            </p>
          </div>
          <div className="status-pill">
            <ShieldCheck size={17} />
            открытый контур
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
            <span>источники отчёта</span>
            <strong>{sourceCount || "..."}</strong>
          </article>
        </section>

        <section className="main-grid">
          <div className="map-pane">
            <div className="section-title">
              <Layers size={18} />
              <h2>Карта открытого контура</h2>
            </div>
            <MapPanel />
          </div>

          <div className="scenario-pane">
            <div className="section-title">
              <Activity size={18} />
              <h2>Демо-сценарии</h2>
            </div>
            <div className="scenario-list">
              {scenarios.map((scenario) => (
                <article key={scenario.id} className="scenario-row">
                  <div>
                    <strong>{scenario.title}</strong>
                    <span>{scenario.description}</span>
                  </div>
                  <small>{scenario.version}</small>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lower-grid">
          <div className="catalog-table">
            <div className="section-title">
              <Archive size={18} />
              <h2>Каталог данных</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Датасет</th>
                  <th>Домен</th>
                  <th>Версия</th>
                  <th>Качество</th>
                </tr>
              </thead>
              <tbody>
                {datasets.slice(0, 8).map((dataset) => (
                  <tr key={dataset.id}>
                    <td>{dataset.title}</td>
                    <td>{dataset.domain}</td>
                    <td>{dataset.source_version}</td>
                    <td>
                      <span
                        className={`quality quality-${dataset.quality_flag}`}
                      >
                        {qualityLabels[dataset.quality_flag]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="report-pane">
            <div className="section-title">
              <FileDown size={18} />
              <h2>Отчёт</h2>
            </div>
            <p>
              {run?.result.summary ??
                "Загружается предварительно вычисленный региональный паспорт..."}
            </p>
            <dl>
              <div>
                <dt>Версия датасета</dt>
                <dd>{run?.dataset_version ?? "..."}</dd>
              </div>
              <div>
                <dt>Модель</dt>
                <dd>{run?.model_version ?? "..."}</dd>
              </div>
              <div>
                <dt>Сценарий</dt>
                <dd>{run?.scenario_version ?? "..."}</dd>
              </div>
            </dl>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
