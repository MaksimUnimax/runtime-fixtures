"""Item-attributed, signed Ozon delivery charges from closed financial days."""
from datetime import date, timedelta
from hashlib import sha256

# Stable Ozon service names are joined to the current accrual type dictionary.
COMPONENTS = {"Logistic":"logistics", "LastMileCourier":"courier_client_reinvoice",
              "DeliveryToHandoverPlaceByOzon":"delivery_to_handover_place_by_ozon"}


def steps(period):
    yield {"source":"finance","operation":"finance_accrual_types","params":{}}
    day=date.fromisoformat(period["from"])
    while day<=date.fromisoformat(period["to"]):
        stamp=day.isoformat()
        yield {"source":"finance","operation":"finance_accrual_by_day",
               "params":{"date":stamp,"last_id":""},"period":{"from":stamp,"to":stamp}}
        day+=timedelta(days=1)


def types(response):
    from parameter_support.parameter_contract import need
    rows=response["accrual_types"]
    mapping={str(r["id"]):COMPONENTS[r["name"]] for r in rows if r["name"] in COMPONENTS}
    need(len(mapping)==len(COMPONENTS) and set(mapping.values())==set(COMPONENTS.values()),"PARAMETER_FINANCIAL_COMPONENTS_UNKNOWN")
    return mapping


def receive(state, response, sku):
    from parameter_support import economics_accruals as accruals
    from parameter_support.parameter_contract import CANON, need
    from semantics import Rejected
    day=state["step"]["params"]["date"]
    seen=state.setdefault("delivery_seen",{})
    cursor=response["last_id"]
    records=response["accruals"]
    need(isinstance(cursor,str) and isinstance(records,list),"ACCRUAL_RESPONSE_SCHEMA")
    for record in records:
        need(record["date"]==day,"ACCRUAL_DATE_MISMATCH")
        try:
            parsed=accruals.extract(record,lambda kind,raw:sha256(CANON([kind,raw]).encode()).hexdigest())
        except accruals.AccrualError as exc:
            raise Rejected(exc.code) from None
        ident=parsed["id"]; digest=sha256(CANON(parsed).encode()).hexdigest()
        if ident in seen:
            need(seen[ident]==digest,"ACCRUAL_ID_CONTENT_CHANGED")
            continue
        seen[ident]=digest
        for atom in parsed["atoms"]:
            component=state["delivery_types"].get(str(atom["type_id"]))
            if component:
                need(atom["sku"] is not None,"PARAMETER_DELIVERY_SKU_UNALLOCATED")
                if atom["sku"]==sku:
                    state["rows"].append({"component":component,"amount":atom["amount"],"currency":atom["currency"]})
    if cursor:
        need(bool(records) and cursor not in state["cursor_seen"],"ACCRUAL_CURSOR_NO_PROGRESS")
        state["cursor_seen"].append(cursor)
        state["step"]["params"]["last_id"]=cursor
        return False
    state.pop("delivery_seen")
    return True
