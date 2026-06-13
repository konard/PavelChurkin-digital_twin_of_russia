.PHONY: install install-backend install-frontend dev-backend dev-frontend lint test seed-open-data up down migrate

install: install-backend install-frontend

install-backend:
	python -m pip install -e ".[test,dev]"

install-frontend:
	npm --prefix frontend install

dev-backend:
	uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	npm --prefix frontend run dev -- --host 0.0.0.0

lint:
	ruff check .
	black --check backend
	npm --prefix frontend run lint
	npm --prefix frontend run format:check

test:
	pytest

seed-open-data:
	python -m backend.app.cli seed-open-data

migrate:
	alembic upgrade head

up:
	docker compose -f infra/docker-compose.yml up --build

down:
	docker compose -f infra/docker-compose.yml down
