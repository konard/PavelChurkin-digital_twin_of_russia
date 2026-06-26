"""Общие фикстуры тестов.

Слой вакансий по умолчанию ходит в живой API «Работа России» (issue #21).
Чтобы тесты были детерминированными и не зависели от сети, подменяем
сервис на офлайн-вариант, работающий на снятом срезе
``data/demo/vacancies-sample.json``.
"""

from __future__ import annotations

import pytest

import backend.app.main as main
from backend.app.vacancies_service import offline_vacancy_service


@pytest.fixture(autouse=True)
def _offline_vacancies() -> None:
    main.vacancy_service = offline_vacancy_service()
