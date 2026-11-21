"""WB coefficient templates extend the same tool catalogue as ordinary marketplace reports."""
from decimal import Decimal

from ..user_plugins.registry import WB, OZON, store_row
from ..user_plugins.store import adapter


SAVED = "wb.saved_coefficients"
PROJECT = "wb.order_projection"
TEMPLATES = {
    SAVED: "Сохранённые коэффициенты Вайлдберис для магазина или одного артикула. Используй перед расчётами по запросу продавца.",
    PROJECT: "Прогноз для заданного количества заказанных товаров: сохранённые потери, прямая и обратная доставка, комиссия при известном официальном тарифе. Бери quantity, sellerPrice и officialRate только из подтверждённых данных или вопроса продавца.",
}


OZON_SAVED="ozon.saved_coefficients"
OZON_PROJECT="ozon.order_projection"
STORE_LOOKUPS = (SAVED, OZON_SAVED)
TEMPLATES.update({
    OZON_SAVED:"Прочитать сохранённые в плагине Озон коэффициенты магазина или указанного Ozon SKU.",
    OZON_PROJECT:"Прогноз Ozon по сохранённым коэффициентам для заданного количества исходных заказов, при наличии SKU применяются его значения.",
})


def catalogue(profiles):
    rows=[]
    for plugin,templates in ((WB,(SAVED,PROJECT)),(OZON,(OZON_SAVED,OZON_PROJECT))):
        ids=[cid for cid,provider,fields in profiles if provider==plugin.provider and
             (plugin!=OZON or {"seller_client_id","seller_api_key"}.issubset(fields))]
        if ids:
            rows.extend({"id":tid,"purpose":TEMPLATES[tid],"available_stores":ids,
                         "input_policy":{"time_axis":"сохранённые значения"}} for tid in templates)
    return rows


def report(db,scope,item):
    from ..user_plugins.store import values, valid_sku
    cid=item["connectionId"]
    plugin=OZON if item["templateId"] in (OZON_SAVED,OZON_PROJECT) else WB
    metrics=adapter(plugin).METRICS
    store_row(db,scope,plugin,cid)
    args=item.get("input",{}).get("plugin_inputs",{})
    sku=args.get("sku","")
    valid_sku(db,cid,sku,plugin)
    store=values(db,cid,"",plugin)
    specific=values(db,cid,sku,plugin) if sku else {}
    merged=store|specific
    result={"template":item["templateId"],"store":cid,"sku":sku,
            "coefficients":{k:{"label":metrics[k][0],"value":v["value"],"unit":v["unit"],"source":v["source"],
                "period":[v["since"],v["until"]],"updated":v["updated"],"scope":"артикул" if k in specific else "магазин"}
                for k,v in merged.items()},"missing":[v[0] for k,v in metrics.items() if k not in merged]}
    if item["templateId"]in (SAVED,OZON_SAVED):
        return result
    q=args.get("quantity")
    if q is None:
        return {**result,"clarification":"Укажите количество исходно заказанных единиц."}
    q=Decimal(q)
    rates={k:Decimal(v["value"]) for k,v in merged.items()}
    projected={}
    if "forward" in rates:
        projected[metrics["forward"][0]+", ₽"]=q*rates["forward"]
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
            "guidance":"Доставка рассчитана на исходное количество. Обратная доставка в этот показатель не входит." if plugin==OZON else "Это прогноз. Укажите источник коэффициентов. Для суммы комиссии нужны цена продавца и официальный тариф категории и схемы."}
