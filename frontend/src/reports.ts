import type { VacancyFeatureCollection } from "./types";

type Feature = VacancyFeatureCollection["features"][number];

export interface NamedCount {
  name: string;
  count: number;
}

export interface PaidVacancy {
  profession: string;
  employer: string;
  region: string;
  salary: number;
}

export interface DemandPaid {
  profession: string;
  count: number;
  avgSalary: number;
}

export interface CityMetric {
  name: string;
  value: number;
}

export interface DatedVacancy {
  profession: string;
  region: string;
  date: string;
}

export interface VacancyReport {
  topN: number;
  totalAnalyzed: number;
  withSalary: number;
  topProfessions: NamedCount[];
  topPaid: PaidVacancy[];
  topPaidAmongDemand: DemandPaid[];
  topCitiesByCount: NamedCount[];
  topCitiesBySalary: CityMetric[];
  topCitiesByDemandPaid: CityMetric[];
  oldestCreated: DatedVacancy[];
  newestCreated: DatedVacancy[];
  oldestModified: DatedVacancy[];
  newestModified: DatedVacancy[];
}

function salaryOf(feature: Feature): number | null {
  const value = feature.properties.salary_value;
  return typeof value === "number" && value > 0 ? value : null;
}

// Город вакансии для рейтингов по городам (issue #27). Бэкенд выделяет его из
// адреса по маркеру «г»; если город не распознан, там уже лежит регион.
function cityOf(feature: Feature): string {
  return feature.properties.city || feature.properties.region || "—";
}

// Разбор даты из источника («2026-01-12» или «2026-06-26T13:40:00+0300»).
// ``null`` — дата отсутствует или не распознана, такие вакансии в рейтинги по
// дате не попадают.
export function parseDate(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const value = Date.parse(raw);
  return Number.isNaN(value) ? null : value;
}

function topCounts(pairs: Map<string, number>, topN: number): NamedCount[] {
  return Array.from(pairs.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topN);
}

/**
 * Собрать отчёт «Анализ вакансий Работа России» из подгруженного кэша
 * (issue #25). Число позиций в каждом топе задаётся ``topN`` из интерфейса.
 */
export function buildVacancyReport(
  features: Feature[],
  topN: number,
): VacancyReport {
  const limit = Math.max(1, Math.round(topN));

  const professionCounts = new Map<string, number>();
  // Рейтинги «по городам» (issue #27) агрегируются по городу из адреса, а не по
  // региону.
  const cityCounts = new Map<string, number>();
  const citySalarySum = new Map<string, number>();
  const citySalaryN = new Map<string, number>();

  for (const feature of features) {
    const props = feature.properties;
    const profession = props.profession || "—";
    professionCounts.set(
      profession,
      (professionCounts.get(profession) ?? 0) + 1,
    );
    const city = cityOf(feature);
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
    const salary = salaryOf(feature);
    if (salary !== null) {
      citySalarySum.set(city, (citySalarySum.get(city) ?? 0) + salary);
      citySalaryN.set(city, (citySalaryN.get(city) ?? 0) + 1);
    }
  }

  const topProfessions = topCounts(professionCounts, limit);

  // Топ самых оплачиваемых вакансий (по нижней границе зарплаты).
  const topPaid: PaidVacancy[] = features
    .map((feature) => ({ feature, salary: salaryOf(feature) }))
    .filter(
      (item): item is { feature: Feature; salary: number } =>
        item.salary !== null,
    )
    .sort((a, b) => b.salary - a.salary)
    .slice(0, limit)
    .map(({ feature, salary }) => ({
      profession: feature.properties.profession || "—",
      employer: feature.properties.employer || "—",
      region: feature.properties.region || "—",
      salary,
    }));

  // Топ самых оплачиваемых среди самых востребованных: берём востребованные
  // профессии (топ по числу вакансий) и ранжируем их по средней зарплате.
  const demandSet = new Set(topProfessions.map((item) => item.name));
  const demandSalarySum = new Map<string, number>();
  const demandSalaryN = new Map<string, number>();
  for (const feature of features) {
    const profession = feature.properties.profession || "—";
    if (!demandSet.has(profession)) {
      continue;
    }
    const salary = salaryOf(feature);
    if (salary === null) {
      continue;
    }
    demandSalarySum.set(
      profession,
      (demandSalarySum.get(profession) ?? 0) + salary,
    );
    demandSalaryN.set(profession, (demandSalaryN.get(profession) ?? 0) + 1);
  }
  const topPaidAmongDemand: DemandPaid[] = Array.from(demandSet)
    .map((profession) => {
      const n = demandSalaryN.get(profession) ?? 0;
      const avg = n > 0 ? (demandSalarySum.get(profession) ?? 0) / n : 0;
      return {
        profession,
        count: professionCounts.get(profession) ?? 0,
        avgSalary: Math.round(avg),
      };
    })
    .sort((a, b) => b.avgSalary - a.avgSalary)
    .slice(0, limit);

  const topCitiesByCount = topCounts(cityCounts, limit);

  const topCitiesBySalary: CityMetric[] = Array.from(citySalaryN.keys())
    .map((name) => {
      const n = citySalaryN.get(name) ?? 0;
      return {
        name,
        value: n > 0 ? Math.round((citySalarySum.get(name) ?? 0) / n) : 0,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  // Топ городов по «оплачиваемым среди востребованных»: средняя зарплата
  // вакансий востребованных профессий по каждому городу.
  const cityDemandSum = new Map<string, number>();
  const cityDemandN = new Map<string, number>();
  for (const feature of features) {
    const profession = feature.properties.profession || "—";
    if (!demandSet.has(profession)) {
      continue;
    }
    const salary = salaryOf(feature);
    if (salary === null) {
      continue;
    }
    const city = cityOf(feature);
    cityDemandSum.set(city, (cityDemandSum.get(city) ?? 0) + salary);
    cityDemandN.set(city, (cityDemandN.get(city) ?? 0) + 1);
  }
  const topCitiesByDemandPaid: CityMetric[] = Array.from(cityDemandN.keys())
    .map((name) => {
      const n = cityDemandN.get(name) ?? 0;
      return {
        name,
        value: n > 0 ? Math.round((cityDemandSum.get(name) ?? 0) / n) : 0,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const byDate = (
    field: "created_at" | "modified_at",
    direction: "asc" | "desc",
  ): DatedVacancy[] =>
    features
      .map((feature) => ({
        feature,
        raw: feature.properties[field],
        ts: parseDate(feature.properties[field]),
      }))
      .filter(
        (item): item is { feature: Feature; raw: string; ts: number } =>
          item.ts !== null,
      )
      .sort((a, b) => (direction === "asc" ? a.ts - b.ts : b.ts - a.ts))
      .slice(0, limit)
      .map(({ feature, raw }) => ({
        profession: feature.properties.profession || "—",
        region: feature.properties.region || "—",
        date: raw,
      }));

  const withSalary = features.filter((f) => salaryOf(f) !== null).length;

  return {
    topN: limit,
    totalAnalyzed: features.length,
    withSalary,
    topProfessions,
    topPaid,
    topPaidAmongDemand,
    topCitiesByCount,
    topCitiesBySalary,
    topCitiesByDemandPaid,
    oldestCreated: byDate("created_at", "asc"),
    newestCreated: byDate("created_at", "desc"),
    oldestModified: byDate("modified_at", "asc"),
    newestModified: byDate("modified_at", "desc"),
  };
}

const money = (value: number): string => `${value.toLocaleString("ru-RU")} ₽`;

/** Сериализовать отчёт в Markdown для скачивания (issue #25). */
export function vacancyReportToMarkdown(report: VacancyReport): string {
  const lines: string[] = [];
  lines.push("# Анализ вакансий «Работа России»");
  lines.push("");
  lines.push(
    `Проанализировано вакансий: ${report.totalAnalyzed} ` +
      `(с указанной зарплатой: ${report.withSalary}). ` +
      `Размер топа: ${report.topN}.`,
  );
  lines.push("");

  const numbered = (title: string, rows: string[]): void => {
    lines.push(`## ${title}`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("_нет данных_");
    } else {
      rows.forEach((row, index) => lines.push(`${index + 1}. ${row}`));
    }
    lines.push("");
  };

  numbered(
    "Топ востребованных специальностей",
    report.topProfessions.map((item) => `${item.name} — ${item.count} вак.`),
  );
  numbered(
    "Топ самых оплачиваемых вакансий",
    report.topPaid.map(
      (item) =>
        `${item.profession} (${item.employer}, ${item.region}) — ${money(item.salary)}`,
    ),
  );
  numbered(
    "Топ оплачиваемых среди востребованных",
    report.topPaidAmongDemand.map(
      (item) =>
        `${item.profession} — ${money(item.avgSalary)} (в среднем, ${item.count} вак.)`,
    ),
  );
  numbered(
    "Топ городов по числу вакансий",
    report.topCitiesByCount.map((item) => `${item.name} — ${item.count} вак.`),
  );
  numbered(
    "Топ городов по средней зарплате",
    report.topCitiesBySalary.map(
      (item) => `${item.name} — ${money(item.value)}`,
    ),
  );
  numbered(
    "Топ городов по зарплате востребованных профессий",
    report.topCitiesByDemandPaid.map(
      (item) => `${item.name} — ${money(item.value)}`,
    ),
  );
  numbered(
    "Топ самых давних по дате создания",
    report.oldestCreated.map(
      (item) => `${item.profession} (${item.region}) — ${item.date}`,
    ),
  );
  numbered(
    "Топ недавних по дате создания",
    report.newestCreated.map(
      (item) => `${item.profession} (${item.region}) — ${item.date}`,
    ),
  );
  numbered(
    "Топ самых давних по дате изменения",
    report.oldestModified.map(
      (item) => `${item.profession} (${item.region}) — ${item.date}`,
    ),
  );
  numbered(
    "Топ недавних по дате изменения",
    report.newestModified.map(
      (item) => `${item.profession} (${item.region}) — ${item.date}`,
    ),
  );

  return lines.join("\n");
}
