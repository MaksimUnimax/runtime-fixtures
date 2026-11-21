"""Store- and article-scoped values shared by the settings API and matrix renderer."""
import json
from datetime import datetime, timezone
from uuid import uuid4
from starlette.exceptions import HTTPException
from .registry import WB, OZON
from ..marketplace_matrix import wb_coefficients as wb, ozon_coefficients as oz


def adapter(plugin):
    return {WB.id: wb, OZON.id: oz}[plugin.id]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def values(db, cid, sku, plugin):
    rows = db.execute("""SELECT metric,value,source,since,until,updated,revision,basis FROM user_plugin_values
        WHERE plugin=? AND cid=? AND sku=?""",(plugin.id,cid,sku))
    return {k:dict(value=v, source=source, since=a, until=b, updated=t, revision=rev,
                   basis=json.loads(basis) if basis else None, unit=adapter(plugin).METRICS[k][1])
            for k,v,source,a,b,t,rev,basis in rows}


def write_value(db,cid,sku,metric,value,source,since,until,basis,revision,plugin):
    previous = values(db,cid,sku,plugin).get(metric,{})
    if previous.get("revision") != revision:
        raise HTTPException(409,"Значение уже изменилось. Откройте его заново перед сохранением.")
    db.execute("""INSERT INTO user_plugin_values VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(plugin,cid,sku,metric) DO UPDATE SET value=excluded.value, source=excluded.source,
        since=excluded.since, until=excluded.until, updated=excluded.updated, revision=excluded.revision, basis=excluded.basis""",
        (plugin.id,cid,sku,metric,value,source,since,until,now(),uuid4().hex,json.dumps(basis) if basis else None))


def valid_sku(db,cid,sku,plugin):
    if not isinstance(sku,str) or (sku and not db.execute("""SELECT 1 FROM user_plugin_products
        WHERE plugin=? AND cid=? AND sku=?""",(plugin.id,cid,sku)).fetchone()):
        raise HTTPException(400,"Выберите артикул из каталога этого магазина.")
