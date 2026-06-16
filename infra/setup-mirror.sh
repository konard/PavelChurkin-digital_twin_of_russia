#!/usr/bin/env bash
# Настройка зеркала Docker Hub для работы в России.
# Запустите один раз, затем перезапустите Docker Desktop / Docker Engine.
#
# Использование:
#   bash infra/setup-mirror.sh                   # показать текущий daemon.json
#   bash infra/setup-mirror.sh --apply           # применить зеркало и перезапустить (Linux systemd)

set -euo pipefail

MIRRORS='["https://huecker.io","https://dockerhub.timeweb.cloud","https://mirror.gcr.io"]'

# Определяем путь к daemon.json в зависимости от платформы.
if [[ "$(uname)" == "Darwin" ]]; then
  DAEMON_JSON="$HOME/.docker/daemon.json"
else
  DAEMON_JSON="/etc/docker/daemon.json"
fi

echo "==> Целевой файл: $DAEMON_JSON"
echo "==> Зеркала    : $MIRRORS"
echo ""

if [[ "${1:-}" == "--apply" ]]; then
  PARENT="$(dirname "$DAEMON_JSON")"
  if [[ "$PARENT" == "/etc/docker" ]]; then
    sudo mkdir -p "$PARENT"
  else
    mkdir -p "$PARENT"
  fi

  # Если daemon.json уже существует — добавляем / обновляем ключ registry-mirrors.
  if [[ -f "$DAEMON_JSON" ]]; then
    if command -v jq &>/dev/null; then
      TMP=$(mktemp)
      jq --argjson m "$MIRRORS" '."registry-mirrors" = $m' "$DAEMON_JSON" > "$TMP"
      if [[ "$PARENT" == "/etc/docker" ]]; then
        sudo mv "$TMP" "$DAEMON_JSON"
      else
        mv "$TMP" "$DAEMON_JSON"
      fi
    else
      echo "ОШИБКА: утилита jq не найдена. Установите jq и повторите попытку."
      exit 1
    fi
  else
    CONTENT="{\"registry-mirrors\": $MIRRORS}"
    if [[ "$PARENT" == "/etc/docker" ]]; then
      echo "$CONTENT" | sudo tee "$DAEMON_JSON" > /dev/null
    else
      echo "$CONTENT" > "$DAEMON_JSON"
    fi
  fi

  echo "==> Файл обновлён."

  # Перезапускаем Docker только на Linux с systemd.
  if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
    echo "==> Перезапуск Docker Engine..."
    sudo systemctl restart docker
    echo "==> Готово. Запустите 'make up'."
  else
    echo "==> Перезапустите Docker Desktop вручную, затем выполните 'make up'."
  fi
else
  echo "Чтобы применить настройки, выполните:"
  echo "  bash infra/setup-mirror.sh --apply"
  echo ""
  echo "Или добавьте вручную в $DAEMON_JSON:"
  echo "  { \"registry-mirrors\": $MIRRORS }"
  echo ""
  echo "Для Docker Desktop: Настройки → Docker Engine → вставьте конфиг → Apply & Restart."
fi
