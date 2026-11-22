"""Validated, serializable timer plans; data references are paths, never executable code."""
import operator
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from . import schedule


class PlanError(ValueError):
    pass


OPS = {"gt": operator.gt, "gte": operator.ge, "lt": operator.lt, "lte": operator.le,
       "eq": operator.eq, "ne": operator.ne}


def numeric(value):
    if type(value) not in (int, float, str):
        raise PlanError("Источник не вернул число.")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise PlanError("Источник не вернул число.") from None
    if not number.is_finite():
        raise PlanError("Источник вернул недопустимое число.")
    return number


def resolve(root, path):
    if not isinstance(path, list):
        raise PlanError("Укажите путь к значению источника.")
    value = root
    for part in path:
        if isinstance(value, dict) and isinstance(part, str) and part in value:
            value = value[part]
        elif isinstance(value, list) and type(part) is int and 0 <= part < len(value):
            value = value[part]
        elif isinstance(value,list) and isinstance(part,dict) and set(part)=={"filter"} and isinstance(part["filter"],dict) and part["filter"]:
            value=[row for row in value if isinstance(row,dict) and all(k in row and row[k]==v for k,v in part["filter"].items())]
        elif isinstance(value, list) and isinstance(part, dict) and set(part) == {"field", "equals"}:
            matches = [item for item in value if isinstance(item, dict) and item.get(part["field"]) == part["equals"]]
            if len(matches) != 1:
                raise PlanError("Для указанного объекта требуется одна подтверждённая строка.")
            value = matches[0]
        else:
            raise PlanError("Источник не вернул согласованное поле.")
    return value


def bind_params(value, facts):
    """Resolve only explicit references from the accepted recipe to this run's fresh observations."""
    if isinstance(value,dict):
        if set(value)=={"from"}:
            result=resolve(facts,value["from"])
            if result is None or isinstance(result,(dict,list)):
                raise PlanError("Для цели действия требуется одно точное значение.")
            return result
        return {k:bind_params(v,facts) for k,v in value.items()}
    if isinstance(value,list):
        return [bind_params(v,facts) for v in value]
    return value


def dates(value, local_day):
    if isinstance(value, list):
        return [dates(item, local_day) for item in value]
    if isinstance(value, dict):
        if set(value) == {"dayOffset"} and type(value["dayOffset"]) is int:
            return (local_day + timedelta(days=value["dayOffset"])).isoformat()
        return {key: dates(item, local_day) for key, item in value.items()}
    return value


def local_time(when, rule):
    return schedule.timestamp(when).astimezone(ZoneInfo(rule["zone"]))


def decision(action, facts):
    condition = action["when"]
    lhs = resolve(facts, condition["path"])
    op = condition["op"]
    if op == "nonempty":
        if not isinstance(lhs, (list, dict, str)):
            raise PlanError("Проверка наличия требует списка, объекта или строки.")
        match = bool(lhs)
    elif op in ("gt", "lt", "gte", "lte"):
        match = OPS[op](numeric(lhs), numeric(condition["value"]))
    else:
        match = OPS[op](lhs, condition["value"])
    if not match:
        return False, None, "Условие не выполнено."
    args = bind_params(action["params"],facts)
    if step := action.get("adjust"):
        before = numeric(resolve(facts, step["current"]))
        after = before + numeric(step["by"])
        lower,upper = step.get("min"),step.get("max")
        if (lower is not None and after < numeric(lower)) or (upper is not None and after > numeric(upper)):
            return True, None, f"Текущее значение {before}. Следующий шаг вышел бы за согласованные границы."
        if step["encoding"] == "integer":
            if after != after.to_integral_value():
                raise PlanError("Команда требует целое значение.")
            args[step["field"]] = int(after)
        else:
            args[step["field"]] = format(after, "f")
        return True, args, f"Изменение с {before} до {after}."
    return True, args, "Условие выполнено."


def validate(plan, rule, kind):
    schedule.validate(rule)
    if not isinstance(plan, dict) or set(plan) - {"steps","format","telegram","notify","action"}:
        raise PlanError("Не удалось проверить план поручения.")
    if not isinstance(plan.get("steps"), list) or not plan["steps"]:
        raise PlanError("Для теста требуется хотя бы один источник.")
    if type(plan.get("telegram")) is not bool or plan.get("notify") not in ("all","changes","goal","errors"):
        raise PlanError("Уточните каналы и условие уведомления.")
    if not isinstance(plan.get("format"), str) or not plan["format"].strip():
        raise PlanError("Уточните формат отчёта.")
    for step in plan["steps"]:
        if not isinstance(step, dict) or set(step) != {"tool","args"} or not isinstance(step["args"], dict):
            raise PlanError("Не удалось проверить шаг чтения.")
        tool, args = step["tool"], step["args"]
        if tool not in ("clock", "marketplace_report", "marketplace_read", "wordstat_keywords","check_store_access"):
            raise PlanError("У этого источника нет доступного инструмента чтения.")
        if tool == "marketplace_read" and args.get("action") != "read":
            raise PlanError("Тест может выполнять только чтение.")
        if tool == "clock" and args:
            raise PlanError("Часы используют время события.")
    if kind == "report" and plan.get("action") is None:
        return
    a = plan.get("action")
    if kind != "action" or not isinstance(a, dict) or set(a) - {"when","templateId","connectionId","params","mode","adjust","command","stopAtBound"}:
        raise PlanError("Уточните отслеживаемое условие и действие.")
    if (not isinstance(a.get("when"),dict) or not isinstance(a["when"].get("path"),list)
            or not a["when"]["path"] or type(a["when"]["path"][0]) is not int
            or not 0 <= a["when"]["path"][0] < len(plan["steps"]) or a["when"].get("op") not in {*OPS,"nonempty"} or
            (a["when"]["op"] != "nonempty" and "value" not in a["when"])):
        raise PlanError("Требуется проверяемое условие действия.")
    if (a.get("mode") not in ("once","edge","each") or not isinstance(a.get("params"), dict)
            or any(not isinstance(a.get(k), str) or not a[k].strip() for k in ("templateId","connectionId","command"))):
        raise PlanError("Уточните цель, параметры и правило повтора.")
    if "stopAtBound" in a and (type(a["stopAtBound"]) is not bool or not a.get("adjust")):
        raise PlanError("Остановка на границе относится к пошаговому действию.")
    if a.get("adjust") is not None:
        step = a["adjust"]
        if (not isinstance(step,dict) or (set(step) - {"current","field","by","min","max","encoding"} or not {"current","field","by","encoding"} <= set(step))
                or not isinstance(step["current"],list) or not isinstance(step["field"],str)
                or not step["field"] or step["field"] in a["params"] or step["encoding"] not in ("integer","decimal")
                or numeric(step["by"]) == 0 or (numeric(step["by"]) < 0 and step.get("min") is None)
                or (numeric(step["by"]) > 0 and step.get("max") is None)
                or (step.get("min") is not None and step.get("max") is not None and numeric(step["min"]) > numeric(step["max"]))):
            raise PlanError("Нужны источник текущего значения, точный шаг и диапазон изменения.")
