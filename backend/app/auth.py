"""Демо-авторизация открытого контура.

В v0.1 нет настоящего хранилища пользователей: используется небольшой набор
демонстрационных учётных записей, чтобы показать роли открытого контура
(Гость, Гражданин, Бизнес, Разработчик) и роль оператора платформы (админ).
Гость работает без пароля и только для чтения.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.app.schemas import Role


@dataclass(frozen=True)
class DemoAccount:
    username: str
    password: str
    role: Role
    display_name: str
    description: str


# Демонстрационные учётные записи открытого контура.
DEMO_ACCOUNTS: dict[str, DemoAccount] = {
    account.username: account
    for account in (
        DemoAccount(
            username="operator",
            password="operator2026",
            role="operator",
            display_name="Оператор платформы",
            description="Администратор демо-стенда: запуск сценариев, экспорт, аудит, API-ключи.",
        ),
        DemoAccount(
            username="developer",
            password="developer2026",
            role="developer",
            display_name="Разработчик",
            description="Полный открытый контур и выпуск API-ключей.",
        ),
        DemoAccount(
            username="business",
            password="business2026",
            role="business",
            display_name="Бизнес",
            description="Запуск сценариев и экспорт отчётов открытого контура.",
        ),
        DemoAccount(
            username="citizen",
            password="citizen2026",
            role="citizen",
            display_name="Гражданин",
            description="Запуск демо-сценариев и просмотр отчётов открытого контура.",
        ),
    )
}


def authenticate(username: str, password: str) -> DemoAccount | None:
    """Возвращает учётную запись при совпадении пароля, иначе ``None``."""

    account = DEMO_ACCOUNTS.get(username.strip().lower())
    if account is None or account.password != password:
        return None
    return account
