FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY backend /app/backend
COPY data /app/data

RUN python -m pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
