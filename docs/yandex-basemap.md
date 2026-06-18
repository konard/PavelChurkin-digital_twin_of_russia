# Подложка Яндекс Карт и переменные `VITE_*`

## Почему подложка не переключалась на Яндекс

Фронтенд собран на Vite. Переменные окружения с префиксом `VITE_`
(`VITE_YANDEX_API_KEY`, `VITE_API_BASE_URL`) **подставляются в бандл во время
сборки** (`npm run build`), а не читаются в рантайме. Поэтому:

- задать `VITE_YANDEX_API_KEY` в окружении уже запущенного контейнера
  бесполезно — бандл собран без ключа, и кнопка «Яндекс» остаётся отключённой;
- простой перезапуск контейнера (`docker restart` / `docker compose restart`)
  **не пересобирает** фронтенд, поэтому ключ так и не попадает в код.

Это и было причиной из issue #17: «карта не переключается на Яндекс, хотя я
прописал `VITE_YANDEX_API_KEY=...`».

## Как правильно включить Яндекс Карты

1. Скопируйте пример окружения и впишите ключ:

   ```bash
   cp .env.example .env
   # отредактируйте .env:
   # VITE_YANDEX_API_KEY=ваш-ключ-яндекса
   ```

2. **Пересоберите** образ фронтенда и поднимите стек:

   ```bash
   make up      # эквивалент: docker compose -f infra/docker-compose.yml up --build
   ```

   `make up` всегда вызывает `up --build`, поэтому образ пересобирается, и ключ
   из `.env` попадает в бандл через build-arg.

   Если контейнеры уже запущены и вы только что добавили ключ — недостаточно
   `make down && make up` без пересборки. Используйте именно `make up` (с
   `--build`) или явно: `docker compose -f infra/docker-compose.yml build frontend`.

3. После пересборки в сайдбаре карты кнопка «Яндекс» станет активной.

## Как ключ доходит до бандла

`infra/docker-compose.yml` пробрасывает переменные в сборку как build-args:

```yaml
frontend:
  build:
    context: ..
    dockerfile: frontend/Dockerfile
    args:
      VITE_YANDEX_API_KEY: ${VITE_YANDEX_API_KEY:-}
      VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}
```

`frontend/Dockerfile` объявляет соответствующие `ARG`/`ENV` перед
`npm run build`:

```dockerfile
ARG VITE_YANDEX_API_KEY=""
ARG VITE_API_BASE_URL=""
ENV VITE_YANDEX_API_KEY=$VITE_YANDEX_API_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build
```

Значения `${VITE_YANDEX_API_KEY:-}` Docker Compose берёт из файла `.env` в
корне репозитория (или из переменных окружения текущей сессии). Если ключ не
задан — подложка остаётся OSM, а кнопка «Яндекс» отключена с подсказкой.

## Лимиты бесплатного плана Яндекса

HTTP-геокодер Яндекса в бесплатном плане ограничен ~1000 запросов/час и
~950 запросов/сутки. Поэтому геокодирование адресов вакансий по умолчанию идёт
через бесплатный Nominatim (≤1 запрос/с), а подложка Яндекс Карт подключается
только для отображения тайлов при наличии ключа.
