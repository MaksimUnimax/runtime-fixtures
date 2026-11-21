"""Ozon plugin catalogue and typed calls into the shared marketplace matrix."""
import asyncio
from decimal import Decimal, localcontext
from pathlib import Path
import time

from .wb_coefficients import DataError, number

METRICS={
    "loss":("Доля отмен и возвратов","%",("parameter.loss_rate.v1",)),
    "forward":("Прямая и последняя доставка","₽/заказанную единицу",("parameter.delivery_mean.v1",)),
}
PARAMETERS={"loss":("loss_rate","ratio"),"forward":("delivery_mean","RUB/ordered_unit")}


def validate(metric,value):
    amount=number(value)
    if metric not in METRICS or amount<0 or (metric=="loss" and amount>100):
        raise DataError("Значение выходит за границы показателя.")
    if not amount:
        return "0"
    value=format(amount,"f")
    with localcontext() as arithmetic:
        arithmetic.prec=max(80,len(value)+3)
        ratio=format(amount.scaleb(-2),"f") if metric=="loss" else value
    if len(ratio.rstrip("0").replace(".","") if "." in ratio else ratio)>60:
        raise DataError("Введите значение с меньшим количеством десятичных знаков.")
    return value.rstrip("0").rstrip(".") if "." in value else value


def headers(fields):
    if not (fields.get("client_id") and fields.get("api_key")):
        raise DataError("Для товаров и коэффициентов добавьте Client-Id и Api-Key Seller API в «Интеграциях».")
    return {"Client-Id":fields["client_id"],"Api-Key":fields["api_key"]}


def sources():
    return {"cards":"https://api-seller.ozon.ru/v3/product/list","info":"https://api-seller.ozon.ru/v3/product/info/list"}


async def products(read):
    cursor=""; seen=set(); product_ids=set(); rows={}; expected=None
    while True:
        page=(await read("cards",{"filter":{"visibility":"ALL"},"last_id":cursor,"limit":1000}))["result"]
        entries=page["items"]
        if expected is None:
            expected=page["total"]
        if type(expected)!=int or expected<0 or page["total"]!=expected or not isinstance(entries,list):
            raise DataError("Каталог Ozon изменился во время загрузки. Обновите товары.")
        ids=[str(row["product_id"]) for row in entries]
        if len(ids)!=len(set(ids)) or product_ids.intersection(ids):
            raise DataError("Ozon повторил страницу товаров.")
        product_ids.update(ids)
        if ids:
            details=(await read("info",{"product_id":ids}))["items"]
            if len(details)!=len(ids) or {str(p["id"]) for p in details}!=set(ids):
                raise DataError("Ozon ещё не вернул сведения обо всех карточках. Обновите товары.")
            for item in details:
                identifiers=[item.get("sku"),*(src.get("sku") for src in item.get("sources") or [])]
                for sku in {str(value) for value in identifiers if str(value).isdigit() and int(value)>0}:
                    record=(sku,str(item["offer_id"]),str(item["name"]))
                    if sku in rows and rows[sku]!=record:
                        raise DataError("Ozon прислал один SKU для разных товаров.")
                    rows[sku]=record
        if len(product_ids)==expected:
            return list(rows.values())
        cursor=page["last_id"]
        if len(product_ids)>expected or not ids or not cursor or cursor in seen:
            raise DataError("Ozon не подтвердил полноту списка товаров. Обновите товары.")
        seen.add(cursor)


async def calculate(scope,cid,metric,period,sku,grant,jid,database):
    from .plugin import invoke
    tid=METRICS[metric][2][0]
    start,end=(day.isoformat() for day in period)
    dates={"from":start,"to":end}
    request={"period":dates,"filters":{"sku":sku} if sku else {}}
    packet={"actor":scope.actor_id,"workspace":scope.workspace_id,"chat":scope.chat_id,"connections":[cid],
            "coefficientJob":True,"selections":[{"templateId":tid,"connectionId":cid,"input":request}],
            "turn":{"databasePath":str(Path(database).resolve()),"token":grant.token,"requestId":"plugin."+jid,
                    "question":METRICS[metric][0],"resumeRateLimits":True,"deadline":int(time.time()*1000)+120000}}
    response=await asyncio.to_thread(invoke,packet,None)
    public=response["public"]
    if not public.get("ok"):
        raise DataError(public.get("reason") or "Не удалось подтвердить коэффициент по отчётам Ozon.")
    row=response.get("coefficient") or {}
    key,unit=PARAMETERS[metric]
    if (row.get("parameter"),row.get("unit"),row.get("period"),row.get("sku"),row.get("store"))!=(key,unit,dates,sku,cid):
        raise DataError("Результат расчёта не соответствует выбранному магазину, товару или периоду.")
    amount=Decimal(row["value"])
    with localcontext() as ctx:
        ctx.prec=max(80,len(amount.as_tuple().digits)+3)
        value=validate(metric,amount*100 if metric=="loss" else amount)
    return value,{"inputs":row["inputs"],"controls":row["controls"],"collectedAt":row["collected_at"]}
