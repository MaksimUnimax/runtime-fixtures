"""WB coefficient templates extend the same tool catalogue as ordinary marketplace reports."""
from decimal import Decimal

from ..user_plugins.registry import WB, store_row
from .wb_coefficients import METRICS

SAVED = "wb.saved_coefficients"
PROJECT = "wb.order_projection"
TEMPLATES = {
    SAVED: "Сохранённые коэффициенты Вайлдберис для магазина или одного артикула. Используй перед расчётами по запросу продавца.",
    PROJECT: "Прогноз для заданного количества заказанных товаров: сохранённые потери, прямая и обратная доставка, комиссия при известном официальном тарифе. Бери quantity, sellerPrice и officialRate только из подтверждённых данных или вопроса продавца.",
}


def catalogue(profiles):
    ids = [cid for cid,platform,_ in profiles if platform=="wb"]
    return [{"id":tid,"purpose":purpose,"available_stores":ids,"input_policy":{"time_axis":"сохранённые значения"}}
            for tid,purpose in TEMPLATES.items()] if ids else []


def report(db,scope,item):
    from ..user_plugins.store import values, valid_sku
    cid=item["connectionId"]
    store_row(db,scope,WB,cid)
    args=item["input"].get("plugin_inputs",{})
    sku=args.get("sku","")
    valid_sku(db,cid,sku)
    store=values(db,cid,"")
    specific=values(db,cid,sku) if sku else {}
    merged=store|specific
    result={"template":item["templateId"],"store":cid,"sku":sku,
            "coefficients":{k:{"label":METRICS[k][0],"value":v["value"],"unit":v["unit"],"source":v["source"],
                "period":[v["since"],v["until"]],"updated":v["updated"],"scope":"артикул" if k in specific else "магазин"}
                for k,v in merged.items()},"missing":[v[0] for k,v in METRICS.items() if k not in merged]}
    if item["templateId"]==SAVED:
        return result
    q=args.get("quantity")
    if q is None:
        return {**result,"clarification":"Укажите количество исходно заказанных единиц."}
    q=Decimal(q)
    rates={k:Decimal(v["value"]) for k,v in merged.items()}
    projected={}
    if "forward" in rates:
        projected["Прямая доставка, ₽"]=q*rates["forward"]
    if "loss" in rates:
        lost=q*rates["loss"]/100
        projected["Ожидаемые потери, шт."]=lost
        projected["Ожидаемые оставшиеся единицы, шт."]=q-lost
        if "reverse" in rates:
            projected["Обратная доставка, ₽"]=lost*rates["reverse"]
        if "sellerPrice" in args:
            revenue=(q-lost)*Decimal(str(args["sellerPrice"]))
            projected["Оборот после потерь, ₽"]=revenue
            if "officialRate" in args and "commission" in rates:
                effective=Decimal(str(args["officialRate"]))+rates["commission"]
                if 0<=effective<=100:
                    projected["Расчётная комиссия, %"]=effective
                    projected["Комиссия после потерь, ₽"]=revenue*effective/100
    return {**result,"forecast":{k:format(v,"f") for k,v in projected.items()},
            "guidance":"Это прогноз. Укажите источник коэффициентов. Для суммы комиссии нужны цена продавца и официальный тариф категории и схемы."}
