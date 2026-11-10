"""Public synthetic QA documents; deploy generated JSON outside worker mounts."""
import json
import os
from pathlib import Path
import sys

DAY = "2026-11-08"

def manifest():
    return {"campaign": "short_answer_r3", "period": DAY, "cases": [
        {"name": "count", "question": "Сколько раз открывали карточки за восьмое ноября?",
         "notes": "Открытия — сумма current.opens. previous — прошлый период, не прибавляй его.",
         "data": {"date": DAY, "products": [
             {"current": {"opens": n}, "previous": {"opens": 9000}, "description": "X" * 70000}
             for n in [1000, 600, 42]]}, "expected": {"opens": 1642}},
        {"name": "money", "question": "Сколько составили расходы на логистику за восьмое ноября?",
         "notes": "Суммируй amount для service=logistics за выбранный день. Возврат отрицательный. Суммы складывай в копейках.",
         "data": {"services": [
             {"date": DAY, "service": "logistics", "amount": "125.40"},
             {"date": DAY, "service": "logistics", "amount": "18.70"},
             {"date": DAY, "service": "logistics", "amount": "-3.73"},
             {"date": DAY, "service": "storage", "amount": "9999.99"},
             {"date": "2026-11-07", "service": "logistics", "amount": "8888.88"}]},
         "expected": {"logistics_rub": "140.37"}},
        {"name": "composite", "question": "Назови оборот заказов, расходы на рекламу и ДРР за восьмое ноября.",
         "notes": "За выбранный день: оборот=sum(orders.revenue); реклама=sum(ads.spend); ДРР=100*реклама/оборот. При нулевом обороте ДРР не определён. Нужны все три показателя.",
         "data": {"orders": [{"date": DAY, "revenue": "1000.00"}, {"date": DAY, "revenue": "1500.00"},
                             {"date": "2026-11-07", "revenue": "99999.00"}],
                  "ads": [{"date": DAY, "spend": "100.00"}, {"date": DAY, "spend": "75.00"},
                          {"date": "2026-11-07", "spend": "9999.00"}]},
         "expected": {"revenue_rub": "2500.00", "ad_spend_rub": "175.00", "drr_percent": "7"}}]}

def currency_manifest():
    case = manifest()["cases"][-1]
    case["name"] = "composite_with_currency"
    case["data"]["currency"] = "RUB"
    return {"campaign": "short_answer_r3_units", "period": DAY, "cases": [case]}

if __name__ == "__main__":
    os.umask(0o077)
    Path(sys.argv[1]).write_text(json.dumps(manifest(), ensure_ascii=False, separators=(",", ":")) + "\n")
