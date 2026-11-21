"""Service-wide chat selection and OpenRouter's account-scoped model catalogue."""
from decimal import Decimal, InvalidOperation
import re

from starlette.exceptions import HTTPException

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS chat_model_policy(
       singleton INTEGER PRIMARY KEY CHECK(singleton=1), route TEXT NOT NULL,
       effort TEXT NOT NULL, free INTEGER NOT NULL, revision INTEGER NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS model_choice_terms(
       workspace TEXT PRIMARY KEY REFERENCES workspaces, revision INTEGER NOT NULL, free INTEGER NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS operation_model_efforts(
       operation_id TEXT PRIMARY KEY REFERENCES usage_operations, effort TEXT NOT NULL)""",
)
MODEL = re.compile(r"~?[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.:-]+")
BRANDS = {"openai":"OpenAI","anthropic":"Anthropic","deepseek":"DeepSeek","google":"Google",
          "meta-llama":"Meta","mistralai":"Mistral AI","qwen":"Alibaba","alibaba":"Alibaba",
          "bytedance-seed":"ByteDance","bytedance":"ByteDance","x-ai":"xAI","z-ai":"Z.ai",
          "black-forest-labs":"Black Forest Labs","moonshotai":"Moonshot AI"}

def amount(raw):
    if isinstance(raw,bool) or raw is None:
        raise ValueError("Missing amount")
    try:
        number = Decimal(str(raw))
        if not number.is_finite() or number < 0 or number > 1000:
            raise ValueError("Invalid amount")
        return number
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc

def catalog_rows(data):
    if not isinstance(data.get("data"),list):
        raise ValueError("Invalid catalogue")
    result = {}
    for row in data["data"]:
        try:
            model = row["id"]
            if not MODEL.fullmatch(model):
                continue
            author = (row.get("canonical_slug") or model).split("/",1)[0].removeprefix("~")
            family = BRANDS.get(author,author) if author != "openrouter" else "Производитель не указан"
            outputs = row["architecture"]["output_modalities"]
            params = row.get("supported_parameters") or []
            price = row.get("pricing") or {}
            try:
                rates = [amount(price[k]) for k in ("prompt","completion")] + [amount(price.get("request",0))]
                free = bool(price) and all(amount(v)==0 for v in price.values())
                paid = all(rates[:2]) and not model.endswith(":free") and all(
                    amount(price.get(k,0)) <= rates[0] for k in ("input_cache_read","input_cache_write"))
            except (ValueError,KeyError):
                rates,free,paid = [],False,False
            chat = "text" in outputs and "tools" in params and bool(free or paid) and author != "openrouter"
            efforts = ["auto"]
            if "reasoning" in params or "reasoning_effort" in params:
                efforts += (row.get("reasoning") or {}).get("supported_levels",["low","medium","high"])
            image_price = None
            if "image" in outputs:
                try:
                    token_rate = max(amount(price.get(k,0)) for k in ("image_output","completion","image_token"))
                    ceiling = int((row.get("top_provider") or {}).get("max_completion_tokens") or row.get("context_length") or 0)
                    if not token_rate or ceiling > 0:
                        image_price = (str(amount(price.get("image",0))),str(token_rate),
                                       str(amount(price["prompt"])),str(amount(price.get("request",0))),ceiling)
                except (ValueError,TypeError,KeyError):
                    pass
            result[model] = dict(id=model,name=row.get("name") or model,family=family,chat=chat,
                                 image="image" in outputs,imagePrice=image_price,free=free,rates=[str(v) for v in rates],
                                 efforts=efforts,defaultEffort="auto")
        except (ValueError,TypeError,KeyError,AttributeError):
            continue
    return result

def policy(db):
    row = db.execute("SELECT route,effort,free,revision FROM chat_model_policy WHERE singleton=1").fetchone()
    return tuple(row) if row else ("direct","auto",False,0)

def selection(db,workspace):
    route,effort,free,revision = policy(db)
    row = db.execute("""SELECT p.model,COALESCE(t.free,0) FROM model_preferences p
                    LEFT JOIN model_choice_terms t USING(workspace)
                    WHERE p.workspace=? AND COALESCE(t.revision,0)=?""",(workspace,revision)).fetchone()
    if row:
        return row[0],"auto",bool(row[1]),revision,False
    return route,effort,bool(free),revision,True

def publish(db,route,effort,free):
    db.execute("""INSERT INTO chat_model_policy VALUES(1,?,?,?,1) ON CONFLICT(singleton) DO UPDATE SET
               route=excluded.route,effort=excluded.effort,free=excluded.free,revision=revision+1""",
               (route,effort,int(free)))

def save_choice(db,workspace,model,revision,catalog):
    current=policy(db)[3]
    if revision != current:
        raise HTTPException(409,"Общая модель изменилась. Обновите выбор.")
    if model == "default":
        db.execute("DELETE FROM model_preferences WHERE workspace=?",(workspace,))
        db.execute("DELETE FROM model_choice_terms WHERE workspace=?",(workspace,))
        return
    if model != "direct" and not catalog.get(model,{}).get("chat"):
        raise HTTPException(400,"Эта модель недоступна для чата с инструментами.")
    db.execute("INSERT OR REPLACE INTO model_preferences VALUES(?,?)",(workspace,model))
    db.execute("INSERT OR REPLACE INTO model_choice_terms VALUES(?,?,?)",
               (workspace,current,int(catalog.get(model,{}).get("free",False))))
