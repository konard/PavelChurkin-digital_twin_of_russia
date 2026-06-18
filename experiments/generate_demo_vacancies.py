"""Сгенерировать расширенную демо-выгрузку вакансий для issue #17.

В исходной демо-выгрузке было всего 107 вакансий, поэтому на карте «больше
107 не подгружалось» — данных просто не было. Этот скрипт сохраняет исходные
107 курируемых строк и дозаполняет файл синтетическими вакансиями вокруг тех
же городов, чтобы продемонстрировать постраничную (инкрементальную) загрузку
по 5000 записей.

Запуск (детерминированный — фиксированный seed):

    python experiments/generate_demo_vacancies.py --total 5400
"""

from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "data" / "demo" / "vacancies.csv"

# Исходные 107 курируемых строк не трогаем — оставляем как «эталонные».
SEED_ROWS = 107

PROFESSIONS = [
    ("Python-разработчик", "ООО «ТехноПарк»", 180000, 270000),
    ("Frontend-разработчик", "АО «Прогресс»", 170000, 240000),
    ("Дата-инженер", "ПАО «Ростех-Регион»", 200000, 260000),
    ("Аналитик данных", "ООО «ДатаСофт»", 150000, 210000),
    ("Медицинская сестра", "ГБУЗ «Городская больница»", 60000, 110000),
    ("Водитель", "МУП «Автопарк»", 70000, 120000),
    ("Учитель математики", "МБОУ «Лицей №1»", 55000, 95000),
    ("Инженер-строитель", "ООО «СтройМонтаж»", 110000, 160000),
    ("Электрогазосварщик", "АО «Завод Металлист»", 90000, 130000),
    ("Продавец-консультант", "ООО «Торговая сеть»", 50000, 100000),
]

# Центры городов из исходной выгрузки (lat, lon).
CITIES = [
    ("Москва", 55.7758, 37.6173),
    ("Санкт-Петербург", 59.9511, 30.3609),
    ("Новосибирск", 55.0284, 82.9357),
    ("Екатеринбург", 56.8589, 60.6057),
    ("Казань", 55.8163, 49.1088),
    ("Нижний Новгород", 56.3165, 43.9361),
    ("Краснодар", 45.0555, 38.9753),
    ("Владивосток", 43.1355, 131.8855),
]


def read_seed(path: Path) -> tuple[str, list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    header = lines[0]
    seed = lines[1 : 1 + SEED_ROWS]
    return header, seed


def generate(total: int) -> list[str]:
    header, seed = read_seed(CSV_PATH)
    rows = list(seed)
    rng = random.Random(20260617)
    next_id = 1000 + SEED_ROWS
    while len(rows) < total:
        city, lat0, lon0 = rng.choice(CITIES)
        profession, employer, low, high = rng.choice(PROFESSIONS)
        lat = lat0 + rng.uniform(-0.08, 0.08)
        lon = lon0 + rng.uniform(-0.12, 0.12)
        salary_from = rng.randrange(low, high, 5000)
        salary_to = salary_from + rng.randrange(20000, 60000, 5000)
        day = 10 + rng.randint(0, 5)
        rows.append(
            ";".join(
                [
                    f"vac-{next_id}",
                    profession,
                    employer,
                    city,
                    f"{lat:.5f}",
                    f"{lon:.5f}",
                    str(salary_from),
                    str(salary_to),
                    "RUB",
                    f"https://trudvsem.ru/vacancy/{next_id}",
                    f"2026-06-{day:02d}",
                ]
            )
        )
        next_id += 1
    return [header, *rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--total", type=int, default=5400)
    args = parser.parse_args()

    lines = generate(args.total)
    CSV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Контрольная проверка корректности CSV.
    with CSV_PATH.open(encoding="utf-8", newline="") as handle:
        count = sum(1 for _ in csv.reader(handle, delimiter=";")) - 1
    print(f"Записано {count} вакансий в {CSV_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
