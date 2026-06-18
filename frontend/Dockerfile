FROM node:22-alpine AS build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./

# Vite «запекает» переменные VITE_* в бандл во время сборки, а не в рантайме,
# поэтому ключ Яндекса и адрес API нужно передавать как build-args, иначе
# подложка Яндекс Карт не включится после простого перезапуска контейнера
# (issue #17). Значения пробрасываются из docker-compose (build.args).
ARG VITE_YANDEX_API_KEY=""
ARG VITE_API_BASE_URL=""
ENV VITE_YANDEX_API_KEY=$VITE_YANDEX_API_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
