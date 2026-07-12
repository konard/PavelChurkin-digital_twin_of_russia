import { useEffect, useRef, useState } from "react";

import { fetchVacanciesMeta, fetchVacanciesPage } from "./api";
import type { Session, VacancyFeatureCollection, VacancyMeta } from "./types";

// Размер страницы открытого API — по столько вакансий подгружаем за один
// запрос при прогрессивной загрузке (issue #23).
export const PAGE_SIZE = 100;
// Предохранитель на массовую подгрузку, если источник не сообщил общий объём.
export const MAX_LOAD_COUNT = 5000;

const EMPTY_VACANCY_FC: VacancyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface VacanciesState {
  allVacancies: VacancyFeatureCollection;
  meta: VacancyMeta | null;
  loadedProgress: number;
  loading: boolean;
  error: string | null;
  loadedAt: Date | null;
  exhausted: boolean;
  runLoad: (target: number) => Promise<void>;
}

/**
 * Общий загрузчик слоя вакансий (issue #25, п. 2).
 *
 * Раньше кэш подгруженных вакансий жил внутри ``MapView`` и обнулялся при
 * переключении раздела (карта → сценарии → карта). Теперь состояние поднято на
 * уровень рабочего пространства и переживает навигацию между разделами, а
 * значит результаты последнего опроса API сохраняются, и их можно использовать
 * в отчёте «Анализ вакансий Работа России».
 */
export function useVacancies(session: Session): VacanciesState {
  const isGuest = session.role === "guest";
  const [allVacancies, setAllVacancies] =
    useState<VacancyFeatureCollection>(EMPTY_VACANCY_FC);
  const [meta, setMeta] = useState<VacancyMeta | null>(null);
  const [loadedProgress, setLoadedProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [exhausted, setExhausted] = useState(false);
  // Токен активной загрузки: увеличиваем при старте новой, чтобы прервать
  // предыдущую (например, при повторном клике «Загрузить»).
  const loadTokenRef = useRef(0);
  // Была ли уже выполнена первичная подгрузка для текущей сессии: не сбрасываем
  // кэш при повторном монтировании ``MapView`` после переключения раздела.
  const primedRef = useRef(false);

  useEffect(() => {
    void fetchVacanciesMeta().then(setMeta);
  }, []);

  const runLoad = async (target: number) => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    setLoadedProgress(0);
    const byId = new Map<
      string,
      VacancyFeatureCollection["features"][number]
    >();
    let page = 0;
    let done = false;
    try {
      while (!done) {
        const collection = await fetchVacanciesPage(page, session);
        if (loadTokenRef.current !== token) {
          return; // загрузку прервал более свежий запрос
        }
        for (const feature of collection.features) {
          byId.set(feature.properties.id, feature);
        }
        setAllVacancies({
          type: "FeatureCollection",
          features: Array.from(byId.values()),
        });
        setLoadedProgress(byId.size);
        const empty = collection.features.length === 0;
        done = isGuest || collection.exhausted || byId.size >= target || empty;
        if (done) {
          setExhausted(collection.exhausted || empty);
        }
        page += 1;
      }
      setLoadedAt(new Date());
    } catch (caught) {
      if (loadTokenRef.current !== token) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось загрузить вакансии.",
      );
    } finally {
      if (loadTokenRef.current === token) {
        setLoading(false);
      }
    }
  };

  // Первичная загрузка одной страницы — один раз на сессию, чтобы карта была не
  // пустой сразу, но кэш не обнулялся при переключении разделов (issue #25).
  useEffect(() => {
    if (primedRef.current) {
      return;
    }
    primedRef.current = true;
    void runLoad(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return {
    allVacancies,
    meta,
    loadedProgress,
    loading,
    error,
    loadedAt,
    exhausted,
    runLoad,
  };
}
