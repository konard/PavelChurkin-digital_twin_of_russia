"""Геокодирование адресов открытого контура.

Реализует требования issue #12:

* по умолчанию используется **бесплатный геокодер Nominatim** с лимитом
  не чаще одного запроса в секунду и контактной почтой в заголовке
  ``User-Agent`` (политика использования Nominatim);
* для возможного перехода на **Яндекс HTTP-геокодер** предусмотрен
  «сторож» лимитов: не более 1000 обращений в час и не более 950 запросов
  в сутки (бесплатный план).

Сетевые вызовы вынесены в инъектируемую функцию ``fetch``, поэтому модуль
полностью тестируется офлайн без обращения к внешним сервисам.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic, sleep

# Контактная почта оператора платформы — подставляется в User-Agent запросов,
# как просили в issue #12.
CONTACT_EMAIL = "paxanch94@inbox.ru"
USER_AGENT = f"DigitalTwinOfRussia/0.1.7 (+{CONTACT_EMAIL})"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

Fetcher = Callable[[str, dict[str, str]], str]


@dataclass(frozen=True)
class GeocodeResult:
    query: str
    lat: float
    lon: float
    display_name: str


def _urllib_fetch(url: str, headers: dict[str, str]) -> str:
    request = urllib.request.Request(url, headers=headers)  # noqa: S310
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return response.read().decode("utf-8")


class NominatimGeocoder:
    """Геокодер Nominatim с жёстким ограничением частоты обращений.

    По умолчанию выдерживается пауза не меньше ``min_interval`` секунд между
    запросами (по умолчанию — 1 секунда, как требует issue #12 и Usage Policy
    Nominatim) и передаётся ``User-Agent`` с контактной почтой.
    """

    def __init__(
        self,
        *,
        user_agent: str = USER_AGENT,
        min_interval: float = 1.0,
        fetch: Fetcher = _urllib_fetch,
        sleeper: Callable[[float], None] = sleep,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self.user_agent = user_agent
        self.min_interval = min_interval
        self._fetch = fetch
        self._sleep = sleeper
        self._clock = clock
        self._last_request: float | None = None

    def _throttle(self) -> None:
        if self._last_request is None:
            return
        wait = self.min_interval - (self._clock() - self._last_request)
        if wait > 0:
            self._sleep(wait)

    def geocode(self, query: str, *, country: str = "Россия") -> GeocodeResult | None:
        params = urllib.parse.urlencode(
            {"q": f"{query}, {country}", "format": "jsonv2", "limit": "1"}
        )
        self._throttle()
        try:
            body = self._fetch(f"{NOMINATIM_URL}?{params}", {"User-Agent": self.user_agent})
        finally:
            self._last_request = self._clock()
        rows = json.loads(body)
        if not rows:
            return None
        top = rows[0]
        return GeocodeResult(
            query=query,
            lat=float(top["lat"]),
            lon=float(top["lon"]),
            display_name=str(top.get("display_name", query)),
        )


class QuotaGuard:
    """Скользящие лимиты для платных/ограниченных сервисов.

    Используется для Яндекс HTTP-геокодера (issue #12): не более
    ``max_per_hour`` обращений в час и не более ``max_per_day`` в сутки.
    """

    def __init__(
        self,
        *,
        max_per_hour: int = 1000,
        max_per_day: int = 950,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self.max_per_hour = max_per_hour
        self.max_per_day = max_per_day
        self._clock = clock
        self._hour: deque[float] = deque()
        self._day: deque[float] = deque()

    def _evict(self, now: float) -> None:
        while self._hour and now - self._hour[0] >= 3600:
            self._hour.popleft()
        while self._day and now - self._day[0] >= 86400:
            self._day.popleft()

    def allow(self) -> bool:
        """Можно ли выполнить ещё один запрос, не превышая лимиты."""

        now = self._clock()
        self._evict(now)
        return len(self._hour) < self.max_per_hour and len(self._day) < self.max_per_day

    def record(self) -> bool:
        """Зафиксировать запрос. Возвращает ``False``, если лимит исчерпан."""

        now = self._clock()
        self._evict(now)
        if len(self._hour) >= self.max_per_hour or len(self._day) >= self.max_per_day:
            return False
        self._hour.append(now)
        self._day.append(now)
        return True

    @property
    def used_last_hour(self) -> int:
        self._evict(self._clock())
        return len(self._hour)

    @property
    def used_last_day(self) -> int:
        self._evict(self._clock())
        return len(self._day)
