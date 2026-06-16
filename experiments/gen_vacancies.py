import csv
import math

# Города РФ: (регион, lat, lon)
cities = [
    ("Москва", 55.7558, 37.6173),
    ("Санкт-Петербург", 59.9311, 30.3609),
    ("Новосибирск", 55.0084, 82.9357),
    ("Екатеринбург", 56.8389, 60.6057),
    ("Казань", 55.7963, 49.1088),
    ("Нижний Новгород", 56.2965, 43.9361),
    ("Краснодар", 45.0355, 38.9753),
    ("Владивосток", 43.1155, 131.8855),
]

# Профессии: (название, базовая зарплата)
professions = [
    ("Python-разработчик", 180000),
    ("Frontend-разработчик", 170000),
    ("Дата-инженер", 200000),
    ("Аналитик данных", 150000),
    ("Медицинская сестра", 60000),
    ("Водитель", 70000),
    ("Учитель математики", 55000),
    ("Инженер-строитель", 110000),
    ("Электрогазосварщик", 90000),
    ("Продавец-консультант", 50000),
]

employers = [
    "ООО «ТехноПарк»", "АО «Прогресс»", "ПАО «Ростех-Регион»",
    "ООО «ДатаСофт»", "ГБУЗ «Городская больница»", "МУП «Автопарк»",
    "МБОУ «Лицей №1»", "ООО «СтройМонтаж»", "АО «Завод Металлист»",
    "ООО «Торговая сеть»",
]

rows = []
vid = 1000
# Москва и Питер получают больше IT-вакансий — для красивой кластеризации.
weights = {
    "Москва": [6, 4, 3, 3, 2, 2, 1, 2, 1, 2],
    "Санкт-Петербург": [4, 3, 2, 2, 2, 2, 1, 2, 1, 2],
}
default_w = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]

for region, lat, lon in cities:
    w = weights.get(region, default_w)
    for pi, (prof, base) in enumerate(professions):
        count = w[pi]
        for k in range(count):
            # лёгкое смещение точек, чтобы кластеры распадались на маркеры
            angle = (pi * 7 + k * 11) % 360
            dlat = 0.02 * math.cos(math.radians(angle)) * (1 + k * 0.4)
            dlon = 0.03 * math.sin(math.radians(angle)) * (1 + k * 0.4)
            sf = base + (k * 10000)
            st = base + 40000 + (k * 10000)
            url = f"https://trudvsem.ru/vacancy/{vid}"
            rows.append([
                f"vac-{vid}", prof, employers[pi], region,
                f"{lat + dlat:.5f}", f"{lon + dlon:.5f}",
                sf, st, "RUB", url, "2026-06-10",
            ])
            vid += 1

with open("data/demo/vacancies.csv", "w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f, delimiter=";")
    writer.writerow([
        "id", "profession", "employer", "region", "latitude", "longitude",
        "salary_from", "salary_to", "currency", "url", "modified_at",
    ])
    writer.writerows(rows)

print("rows:", len(rows))
