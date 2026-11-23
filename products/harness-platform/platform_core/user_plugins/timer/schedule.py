"""UTC instants use integer microseconds. Wall-clock rules use the owner's IANA zone."""
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
MAX_INSTANT = (date.max - EPOCH.date()).days * 86_400_000_000 + 86_399_999_999


def instant(dt):
    if dt.utcoffset() is None:
        raise ValueError("Для даты требуется часовой пояс.")
    delta = dt.astimezone(UTC) - EPOCH
    return delta // timedelta(microseconds=1)


def timestamp(value):
    return EPOCH + timedelta(microseconds=value)


def validate(rule):
    if not isinstance(rule, dict) or not isinstance(rule.get("zone"), str):
        raise ValueError("Укажите часовой пояс расписания.")
    try:
        ZoneInfo(rule["zone"])
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Неизвестный часовой пояс.") from None
    kind = rule.get("kind")
    if kind == "once" and set(rule) == {"kind", "zone", "at"} and isinstance(rule["at"], str):
        instant(datetime.fromisoformat(rule["at"]))
        return
    if kind == "interval" and set(rule) == {"kind", "zone", "every_us"}:
        if type(rule["every_us"]) is int and rule["every_us"] > 0:
            return
    if kind == "calendar" and set(rule) == {"kind", "zone", "weekdays", "times"}:
        days, times = rule["weekdays"], rule["times"]
        if (isinstance(days, list) and days and all(type(d) is int and 1 <= d <= 7 for d in days)
                and isinstance(times, list) and times and all(isinstance(t, str) for t in times)):
            if all(time.fromisoformat(t).tzinfo is None for t in times):
                return
    raise ValueError("Проверьте дату, интервал или дни и время расписания.")


def next_after(rule, after, anchor):
    """First strictly later instant. The anchor stays fixed across delays and pauses."""
    validate(rule)
    kind = rule["kind"]
    if kind == "once":
        value = instant(datetime.fromisoformat(rule["at"]))
        return value if value > after else None
    if kind == "interval":
        step = rule["every_us"]
        value = anchor + max(1, (after - anchor) // step + 1) * step
        return value if value <= MAX_INSTANT else None
    zone = ZoneInfo(rule["zone"])
    day = timestamp(after).astimezone(zone).date()
    times = sorted({time.fromisoformat(t) for t in rule["times"]})
    while True:
        if day.isoweekday() in rule["weekdays"]:
            for wall in times:
                local = datetime.combine(day, wall, tzinfo=zone)
                utc = local.astimezone(UTC)
                # Skip a skipped wall time. A repeated wall time runs on its first occurrence.
                if utc.astimezone(zone).replace(tzinfo=None) == local.replace(tzinfo=None):
                    value = instant(utc)
                    if value > after:
                        return value
        if day == date.max:
            return None
        day += timedelta(days=1)
