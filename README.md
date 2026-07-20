# Цифровой двойник России v0.1

Прототип открытого контура для проекта, описанного в
PavelChurkin/digital_twin_of_russia#1. Репозиторий реализует указанные
SaaS-инструкции: бэкенд на FastAPI, фронтенд React/MapLibre, паспорта
демо-данных открытого контура, запуск сценариев, экспорт отчётов, журнал
аудита и инфраструктура для локальной разработки.

## Область применения

v0.1 — демонстратор, не производственная платформа. Используются только
открытые и агрегированные демо-данные:

- 12 источников данных CSV/файл первой очереди плюс 2 дескриптора API-коннектора;
- паспорта датасетов с источником, версией, лицензией, качеством и ограничениями;
- API открытого контура (только чтение) для каталога, слоёв, объектов, сценариев и отчётов;
- детерминированные демо-сценарии для регионального паспорта, дефицита кадров,
  сравнения площадок, аварийных рисков и сравнения для переезда;
- гостевой режим только для чтения, операции записи для зарегистрированных ролей, API-ключи для
  ролей разработчика/оператора;
- журнал аудита только для добавления с проверкой хеш-цепочки.

Персональные данные, схемы критической инфраструктуры, данные закрытого контура
и автоматические управленческие решения не раскрываются.

## Структура репозитория

```text
backend/              FastAPI-приложение, ETL-каркас, движок сценариев, тесты, Alembic
frontend/             Приложение на Vite + React + TypeScript + MapLibre
infra/                Docker Compose и каркас DAG Airflow
data/demo/            Датасеты открытого контура, слои, объекты, сценарии
data/classifiers/     Начальный seed классификатора
docs/                 Архитектура и заметки по реализации v0.1
.github/workflows/    CI для pull request-ов
```

## Настройка окружения (.env)

Файл `.env` в репозиторий не входит — его нужно создать из шаблона `.env.example`:

```bash
cp .env.example .env        # Linux/macOS
copy .env.example .env      # Windows (cmd)
```

Значений по умолчанию достаточно для запуска через `make up`: docker compose
читает `.env.example`, а ваш `.env` (если создан) переопределяет нужные строки.
Каждая переменная описана прямо в `.env.example`. Ключевые из них:

- `DATABASE_URL`, `REDIS_URL`, `S3_*` — подключения к PostgreSQL/PostGIS, Redis и
  MinIO. Внутри docker compose используются имена сервисов (`postgis`, `redis`,
  `minio`); для запуска без Docker замените их на `localhost`.
- `NASA_FIRMS_MAP_KEY` — необязательный ключ для слоёв пожарной активности.
  Бесплатный ключ выдаётся на
  [странице NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/).
- `OPEN_DATA_REGION` — регион открытых данных по умолчанию для демо-сценариев.

## Что нужно предустановить

Перед запуском установите инструменты. Минимальный набор зависит от способа
запуска: **полный стек через Docker** (проще всего — нужны только Git, Docker и
GNU Make) или **локальная разработка на хосте** (нужны Python и Node.js).

**1. Git** — чтобы клонировать репозиторий.

- Windows: [Git for Windows](https://git-scm.com/download/win) (в комплекте идёт
  Git Bash, в котором работают команды из этого README).
- macOS: `brew install git` или Command Line Tools (`xcode-select --install`).
- Linux (Debian/Ubuntu): `sudo apt install git`.

Проверка: `git --version`.

```bash
git clone https://github.com/PavelChurkin/digital_twin_of_russia.git
cd digital_twin_of_russia
cp .env.example .env        # Linux/macOS (на Windows: copy .env.example .env)
```

**2. Docker и Docker Compose v2** — для запуска всего стека одной командой
`make up` (PostgreSQL/PostGIS, Redis, MinIO, Airflow, бэкенд, фронтенд).

- Windows и macOS: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  (Compose v2 входит в комплект). На Windows включите WSL 2 backend.
- Linux: [Docker Engine](https://docs.docker.com/engine/install/) + плагин
  `docker-compose-plugin`. Чтобы запускать `docker` без `sudo`, добавьте
  пользователя в группу `docker` и перезайдите в сессию.

Проверка: `docker --version` и `docker compose version` (именно `compose` без
дефиса — версия 2). Демон Docker должен быть **запущен** (на Windows/macOS —
открыт Docker Desktop). Если `make up` падает с «unknown type text/html», Docker
не может достучаться до Docker Hub — см. «Устранение неполадок».

**3. GNU Make** — цели `make up`, `make install`, `make test` и т. д. — это
обёртки над длинными командами.

- Windows: входит в Git Bash; либо `choco install make`, либо запускайте команды
  из `Makefile` напрямую (например, `docker compose -f infra/docker-compose.yml
  up --build` вместо `make up`).
- macOS: входит в Command Line Tools (`xcode-select --install`).
- Linux (Debian/Ubuntu): `sudo apt install make`.

Проверка: `make --version`.

**4. Python 3.12+ и Node.js 20+** — только для локальной разработки на хосте
(`make install`, `make lint`, `make test`, `make dev-backend`,
`make dev-frontend`). Для запуска через Docker не нужны — там они уже внутри
образов.

- Python: [python.org](https://www.python.org/downloads/) или менеджер версий
  (`pyenv`, `asdf`). Проверка: `python --version`.
- Node.js: [nodejs.org](https://nodejs.org/) (LTS) или `nvm`. Проверка:
  `node --version`.

После установки инструментов самый быстрый путь — Docker-стек:

```bash
make up     # собрать и поднять весь стек; фронтенд — http://localhost:5173
make down   # остановить стек
```

## Локальная разработка

Цели `make install`, `make lint`, `make test` и `make seed-open-data` запускаются
**на хосте** и требуют установленных Python 3.12+ и Node.js 20+. Сначала выполните
`make install`, иначе команды упадут с ошибкой «не найден файл» (`pytest`/`ruff`)
или кодом `9009` (`python`) — это значит, что инструмент не установлен или не
добавлен в `PATH`. На Windows проверьте установку командами `python --version` и
`node --version`; если используется лаунчер `py`, добавьте Python в `PATH`. Если
локальный toolchain ставить не хочется, пользуйтесь Docker-стеком (`make up`) —
там все зависимости уже собраны.

Установка и полное тестирование:

```bash
make install
make lint
make test
```

Запуск API и фронтенда в отдельных терминалах:

```bash
make dev-backend
make dev-frontend
```

Откройте приложение по адресу `http://localhost:5173`; API доступен по
`http://localhost:8000`, документация OpenAPI — по `http://localhost:8000/docs`.

Сводка сида:

```bash
make seed-open-data
```

Docker-стек (нужны только Git, Docker и GNU Make — см.
«Что нужно предустановить»):

```bash
make up      # docker compose ... up --build: собрать образы и поднять стек
make down    # остановить и удалить контейнеры стека
```

`make up` разворачивает `compose`-стек: PostgreSQL/PostGIS, Redis, MinIO,
Airflow, сервисы бэкенда и фронтенда. Первый запуск дольше — Docker скачивает
базовые образы и собирает свои. После старта:

- фронтенд — `http://localhost:5173`;
- API — `http://localhost:8000`, OpenAPI — `http://localhost:8000/docs`.

Текущий API использует сидированные JSON-данные, поэтому репозиторий можно
тестировать без загрузки внешних данных. Если `make up` падает с ошибкой про
`text/html`, Docker не может скачать образы с Docker Hub — настройте зеркало по
инструкции в разделе «Устранение неполадок».

## API-интерфейс

- `GET /api/v1/catalog/datasets`
- `GET /api/v1/catalog/datasets/{id}`
- `GET /api/v1/layers`
- `GET /api/v1/tiles/{layer}/{z}/{x}/{y}`
- `GET /api/v1/objects/{id}`
- `GET /api/v1/scenarios`
- `POST /api/v1/scenarios/{id}/run`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/export?format=md|pdf`
- `POST /api/v1/auth/keys`
- `GET /api/v1/audit/verify`
- `GET /api/v1/catalog/datasets/{id}/download` — выгрузка сырых данных (CSV),
  только для роли оператора платформы;
- `GET /api/v1/vacancies?profession=&count=` — слой вакансий «Работа России»
  как GeoJSON из открытого API (`total`/`loaded`/`returned`). Гостю отдаётся одна
  страница (заголовок `X-Role: guest`), остальным ролям — указанное в `count`
  число (до 5000);
- `GET /api/v1/vacancies/professions?limit=&count=` — топ профессий для сайдбара;
- `GET /api/v1/vacancies/meta` — метаданные слоя (источник, объём, периодичность);
- `GET /api/v1/config` — рантайм-конфигурация фронтенда (ключ Яндекс Карт без
  пересборки, issue #21).

Каждый ответ с данными содержит провенанс напрямую или через паспорт датасета:
источник, версию источника, лицензию, флаг качества и известные ограничения.

## Что нового в v0.1.8 (issue #27)

Актуальная итерация открытого контура. История прошлых версий (v0.1.4–v0.1.7)
вынесена из README в
[дорожную карту по версиям](docs/матчасть/Дорожная%20карта%20по%20версиям.md):
`1.0.0` — полностью готовый цифровой двойник со всеми контурами и сценариями,
`0.2` — полностью рабочий открытый контур.

- **Город в отчёте по вакансиям берётся из адреса** (issue #27): город выделяется
  из поля «Адрес» вакансии — из части строки после отдельной буквы «г » до
  запятой (например, `… г Славянск-на-Кубани, Отдельская улица, 324` →
  «Славянск-на-Кубани»). Топы городов в отчёте «Анализ вакансий Работа России»
  строятся по этому городу; если город в адресе не распознан, подставляется
  регион.
- **Несколько отчётов по сценариям** (issue #27): каждый запуск сценария
  (кнопка «Запустить» / «Открыть демо») добавляет **отдельный** отчёт — они
  накапливаются с момента нажатия, а не перезаписывают друг друга. Новые отчёты
  показываются сверху и на вкладке «Сценарии», и в разделе «Отчёты», каждый
  скачивается в Markdown.
- **Заглушки контуров** (issue #27): в шапке появился переключатель контуров —
  открытого (рабочий) и ведомственного, закрытого, инфраструктурного и
  исследовательского (заглушки «в разработке» с описанием назначения и
  аудитории). Полный набор контуров запланирован к версии 1.0.0.
- **Раздел архитектуры про WebSocket** (issue #27): описан единый
  мультиплексируемый WebSocket с Pub/Sub-подписками на топики, географической
  фильтрацией (bounding box + тайлинг по зуму), брокером сообщений и шифрованием
  WSS/TLS — вместо отдельного соединения на каждый слой карты. Подробнее:
  [docs/architecture.md](docs/architecture.md).

### Как это выглядит

| Открытый контур (карта) | Переключатель контуров: заглушка |
| ----------------------- | -------------------------------- |
| ![Открытый контур v0.1.8](docs/screenshots/v0.1.8-open-contour.png?raw=true) | ![Заглушка контура v0.1.8](docs/screenshots/v0.1.8-contour-stub.png?raw=true) |

Несколько отчётов по сценариям накапливаются в разделе «Отчёты»:

![Несколько отчётов по сценариям v0.1.8](docs/screenshots/v0.1.8-scenarios-multiple-reports.png?raw=true)

## Требования к серверу (issue #23 п. 8)

Прототип рассчитан на скромный сервер: тяжёлые данные не хранятся локально, а
берутся постранично из открытого API «Работа России».

**Минимально (демо/разработка, запуск без Docker):**

- ОС: Linux, macOS или Windows 10+;
- CPU: 2 ядра;
- RAM: 2 ГБ;
- Диск: ~2 ГБ (репозиторий, зависимости Python/Node, без полной выгрузки
  вакансий — она не сохраняется на диск);
- ПО: Python 3.12+, Node.js 20+;
- Сеть: исходящий HTTPS к `opendata.trudvsem.ru` (вакансии),
  `nominatim.openstreetmap.org` (геокодер) и, при использовании подложки, к
  Яндекс Картам.

**Рекомендуется (полный стек через Docker Compose):**

- CPU: 4 ядра;
- RAM: 8 ГБ (PostgreSQL/PostGIS, Redis, MinIO, Airflow, бэкенд, фронтенд);
- Диск: 10 ГБ свободно под образы и тома;
- ПО: Docker 24+ и Docker Compose v2;
- Сеть: доступ к Docker Hub (или зеркалу — см. «Устранение неполадок»).

Внешние ключи по желанию: `YANDEX_API_KEY` (подложка Яндекс Карт),
`NASA_FIRMS_MAP_KEY` (слои пожарной активности). Без них прототип работает на
OSM-подложке и бесплатном геокодере Nominatim.

## Устранение неполадок

### `make up` падает с ошибкой «encountered unknown type text/html»

Docker не может скачать образы с Docker Hub (`docker.io`), так как реестр
заблокирован или недоступен из вашей сети. Настройте зеркало с помощью
встроенного скрипта:

**Linux / macOS:**

```bash
make setup-mirror   # применяет зеркала и перезапускает Docker Engine (Linux)
# На macOS перезапустите Docker Desktop вручную после выполнения
```

или напрямую:

```bash
bash infra/setup-mirror.sh --apply
```

**Windows (PowerShell от имени администратора):**

```powershell
powershell -ExecutionPolicy Bypass -File infra\setup-mirror.ps1 -Apply
```

Скрипт добавляет следующие зеркала в конфигурацию Docker (`daemon.json`):
`huecker.io`, `dockerhub.timeweb.cloud`, `mirror.gcr.io`.

**Вручную через Docker Desktop:**

1. Откройте Docker Desktop → Настройки (⚙) → Docker Engine.
2. Добавьте в JSON:
   ```json
   {
     "registry-mirrors": [
       "https://huecker.io",
       "https://dockerhub.timeweb.cloud",
       "https://mirror.gcr.io"
     ]
   }
   ```
3. Нажмите **Apply & Restart**, затем выполните `make up`.

## Проверка

Тесты бэкенда фиксируют контракты v0.1:

- каталог содержит 14 паспортов открытого контура;
- гостевой режим блокирует операции записи;
- запуски сценариев записывают версии датасета/модели/сценария;
- экспорт в Markdown включает провенанс и ограничения;
- проверка хеш-цепочки аудита остаётся валидной;
- ETL разбирает CSV в кодировке Windows-1251 и строит паспорта.

CI фронтенда запускает ESLint, проверку Prettier, сборку TypeScript и сборку Vite.
