"""Shared state for direct inference, probing, operation pinning and provider failover."""
import argparse
import asyncio
import hashlib
import json
import math
import os
import time
from collections import Counter
from uuid import uuid4

from . import hub_direct as direct

AUTO = "hub:auto"
PUBLIC = "hub:public"
SCHEMA = """
CREATE TABLE IF NOT EXISTS hub_control(key_id TEXT PRIMARY KEY REFERENCES hub_keys ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1, private_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hub_health(key_id TEXT NOT NULL REFERENCES hub_keys ON DELETE CASCADE,
    model TEXT NOT NULL, verified INTEGER DEFAULT 0, retry INTEGER DEFAULT 0, reason TEXT DEFAULT '',
    quality INTEGER DEFAULT 0, PRIMARY KEY(key_id,model));
CREATE TABLE IF NOT EXISTS hub_leases(lease TEXT PRIMARY KEY,key_id TEXT NOT NULL, model TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hub_lease_route ON hub_leases(key_id,model);
CREATE TABLE IF NOT EXISTS hub_cooldown(account TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_events(t INTEGER NOT NULL,key_id TEXT NOT NULL,model TEXT NOT NULL,
    kind TEXT NOT NULL, reason TEXT NOT NULL, ms INTEGER NOT NULL, stage TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hub_event_time ON hub_events(t);
CREATE TABLE IF NOT EXISTS hub_pins(op TEXT PRIMARY KEY,key_id TEXT NOT NULL,model TEXT NOT NULL,grp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_switches(t INTEGER NOT NULL,op TEXT NOT NULL,previous TEXT NOT NULL,
    current TEXT NOT NULL,reason TEXT NOT NULL,stage TEXT NOT NULL);
"""
TTL = 3600
WINDOW = 604800


def invalidate(db,kid):
    db.execute("DELETE FROM hub_health WHERE key_id=?",(kid,))
    db.execute("UPDATE hub_control SET private_until=0 WHERE key_id=?",(kid,))


class Runtime:
    def __init__(self,hub,http):
        self.hub,self.http=hub,http
        self.routes=direct.config()

    def _rows(self,db):
        keys=db.execute("""SELECT k.*,a.account_id,coalesce(c.enabled,1) enabled,
            coalesce(c.private_until,0) private_until FROM hub_keys k
            LEFT JOIN hub_cloudflare_accounts a ON k.id=a.key_id LEFT JOIN hub_control c ON k.id=c.key_id""")
        health={(r["key_id"],r["model"]):dict(r) for r in db.execute("SELECT * FROM hub_health")}
        now=int(time.time())
        stats={(r[0],r[1]):(r[2],r[3]) for r in db.execute("""SELECT key_id,model,count(*),sum(reason='ok')
            FROM hub_events WHERE t>=? GROUP BY key_id,model""",(now-86400,))}
        slots={(r[0],r[1]):r[2] for r in db.execute("SELECT key_id,model,count(*) FROM hub_leases WHERE expires>? GROUP BY key_id,model",(now,))}
        cooldowns={r[0]:(r[1],r[2]) for r in db.execute("SELECT account,until,reason FROM hub_cooldown WHERE until>?",(now,))}
        def account(k):
            return k["provider"]+"/"+(k["account_id"] or "shared")
        account_load=Counter()
        keys=list(keys)
        for k in keys:
            account_load[account(k)]+=sum(v for (kid,_),v in slots.items() if kid==k["id"])
        for key in keys:
            k=dict(key)
            for (provider,model),s in self.routes.items():
                if provider!=key["provider"]: continue
                rid=key["id"],model
                state=health.get(rid,{})
                count,success=stats.get(rid,(0,0))
                retry=state.get("retry",0)
                account_retry,account_reason=cooldowns.get(account(k),(0,""))
                retry=max(retry,account_retry)
                verified=state.get("verified",0)
                ok=bool(k["enabled"] and verified>now-TTL and retry<=now and state.get("reason")=="ok")
                color=("green" if count>=3 and success/count>=0.95 else "yellow") if ok else "red" if state else "pending"
                yield k,s,dict(model=model,group=s["group"],key=k["id"],label=k["label"],provider=provider,
                     scope="private" if s["scope"]=="private" or k["private_until"]>now else "public",
                     color=color,ready=ok,retry=retry,checked=verified,reason=account_reason or state.get("reason","Ожидается проверка"),
                     power=state.get("quality",0),in_use=account_load[account(k)],capacity=s["slots"],enabled=bool(k["enabled"]))

    def status(self):
        with self.hub.database() as db:
            db.execute("BEGIN")
            return [r for _,_,r in self._rows(db)]

    def catalog(self):
        available=[r for r in self.status() if r["ready"]]
        public=any(r["scope"]=="public" for r in available)
        private={r["group"] for r in available if r["scope"]=="private"}
        entries=[(AUTO,"Автовыбор для чата и отчётов")] if private else []
        entries.extend(("hub:"+m,m) for m in sorted(private))
        if public: entries.append((PUBLIC,"Публичный вопрос · без истории и данных магазинов"))
        return {mid:dict(id=mid,name=name,family="Хаб Octoport",free=True,rates=["0"]*3) for mid,name in entries}

    def summary(self):
        now=int(time.time())
        with self.hub.database() as db:
            db.execute("BEGIN")
            rows=[r for _,_,r in self._rows(db)]
            for r in rows:
                events=list(db.execute("""SELECT t,kind,reason,ms FROM hub_events WHERE key_id=? AND model=?
                    AND t>=? ORDER BY t,rowid""",(r["key"],r["model"],now-WINDOW)))
                r["windows"]={}
                for name,span in (("24h",86400),("7d",WINDOW)):
                    data=[e for e in events if e["t"]>=now-span]
                    latency=sorted(e["ms"] for e in data)
                    bad=Counter(e["reason"] for e in data if e["reason"]!="ok")
                    down=0; start=None; recoveries=[]
                    for e in data:
                        if e["reason"]!="ok" and start is None: start=e["t"]
                        elif e["reason"]=="ok" and start is not None:
                            recoveries.append(e["t"]-start); start=None
                    down=sum(recoveries)+(now-start if start is not None else 0)
                    r["windows"][name]=dict(samples=len(data),probes=sum(e["kind"]=="probe" for e in data),
                        calls=sum(e["kind"]=="call" for e in data),errors=dict(bad),down=down,recoveries=len(recoveries),
                        p95=latency[math.ceil(len(data)*.95)-1] if data else None)
            switches=[dict(r) for r in db.execute("SELECT t,previous,current,reason,stage FROM hub_switches ORDER BY t DESC,rowid DESC LIMIT 40")]
        return {"routes":rows,"switches":switches}

    def _acquire(self,op,choice,excluded,probe=None):
        now=int(time.time())
        with self.hub.database() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM hub_leases WHERE expires<=?",(now,))
            pin=db.execute("SELECT * FROM hub_pins WHERE op=?",(op,)).fetchone()
            matches=[]
            for key,s,r in self._rows(db):
                rid=(key["id"],r["model"])
                if rid in excluded or not r["enabled"] or r["retry"]>now or r["in_use"]>=r["capacity"]: continue
                if probe:
                    if rid!=probe or db.execute("SELECT 1 FROM hub_leases WHERE key_id=? AND model=?",rid).fetchone(): continue
                elif not r["ready"] or (r["scope"]!="private" and choice!=PUBLIC): continue
                preferred=pin["grp"] if pin else choice.removeprefix("hub:")
                rank=(bool(pin and pin["key_id"]==rid[0] and pin["model"]==rid[1]), r["group"]==preferred,
                      r["power"],r["color"]=="green",-r["in_use"])
                matches.append((rank,key,s,r))
            if not matches: return None
            _,key,s,r=max(matches,key=lambda x:x[0])
            lease=uuid4().hex
            db.execute("INSERT INTO hub_leases VALUES(?,?,?,?)",(lease,key["id"],s["model"],now+150))
            return lease,key,s

    def _finish(self,lease,key,spec,kind,stage,reason,delay,ms,quality,op,previous_reason):
        now=int(time.time()); kid=key["id"]; model=spec["model"]
        with self.hub.database() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM hub_leases WHERE lease=?",(lease,))
            current=db.execute("""SELECT k.sealed,a.account_id,coalesce(c.enabled,1),coalesce(c.private_until,0)
                FROM hub_keys k LEFT JOIN hub_cloudflare_accounts a ON k.id=a.key_id
                LEFT JOIN hub_control c ON k.id=c.key_id WHERE k.id=?""",(kid,)).fetchone()
            if not current or tuple(current)!=(key["sealed"],key["account_id"],1,key["private_until"]):
                return False
            db.execute("INSERT INTO hub_events VALUES(?,?,?,?,?,?,?)",(now,kid,model,kind,reason,ms,stage))
            if kind=="probe" or reason!="ok":
                db.execute("""INSERT INTO hub_health VALUES(?,?,?,?,?,?) ON CONFLICT(key_id,model)
                    DO UPDATE SET verified=excluded.verified,retry=excluded.retry,reason=excluded.reason,
                    quality=CASE WHEN excluded.quality>0 THEN excluded.quality ELSE hub_health.quality END""",
                    (kid,model,now if reason=="ok" else 0,0 if reason=="ok" else now+delay,reason,quality))
            if reason=="HTTP 401":
                db.execute("UPDATE hub_health SET verified=0,retry=?,reason=? WHERE key_id=?",(now+delay,reason,kid))
            if reason=="HTTP 429":
                # All keys for this provider conservatively share a cooldown unless distinct accounts are known.
                account=key["provider"]+"/"+(key["account_id"] or "shared")
                db.execute("""INSERT INTO hub_cooldown VALUES(?,?,?) ON CONFLICT(account)
                    DO UPDATE SET until=max(until,excluded.until),reason=excluded.reason""",(account,now+delay,reason))
            if kind=="call" and reason=="ok":
                old=db.execute("SELECT key_id,model FROM hub_pins WHERE op=?",(op,)).fetchone()
                if old and tuple(old)!=(kid,model):
                    db.execute("INSERT INTO hub_switches VALUES(?,?,?,?,?,?)",(now,op,old["model"],model,previous_reason or "Маршрут недоступен",stage))
                elif previous_reason and not old:
                    db.execute("INSERT INTO hub_switches VALUES(?,?,?,?,?,?)",(now,op,"",model,previous_reason,stage))
                db.execute("INSERT OR REPLACE INTO hub_pins VALUES(?,?,?,?)",(op,kid,model,spec["group"]))
            return True

    async def probe(self,kid,model):
        taken=self._acquire("",AUTO,set(),(kid,model))
        if not taken: return
        lease,key,spec=taken
        start=time.monotonic(); quality=0; reason="ok"; delay=0
        try:
            first,_=await direct.call(self.http,spec,key,direct.PROBE,35)
            tool=first["message"]["tool_calls"][0]
            args=json.loads(tool["function"]["arguments"])
            if tool["function"]["name"]!="report" or args.get("orders")!=7 or str(args.get("market")).lower()!="ozon":
                raise direct.Refused("Проверка аргументов инструмента не прошла")
            quality=1
            messages=[*direct.PROBE["messages"],first["message"],
                      {"role":"tool","tool_call_id":tool["id"],"content":'Test fixture: {"orders":19,"wb_cancellations":5,"ozon_cancellations":8}'}]
            final,_=await direct.call(self.http,spec,key,{"messages":messages,"tools":direct.PROBE["tools"],"max_tokens":1400},45)
            if final["finish_reason"]!="stop" or "19" not in (final["message"].get("content") or ""):
                raise direct.Refused("Проверка ответа по данным не прошла")
            quality=2+int("13" in (final["message"].get("content") or ""))
        except direct.Refused as exc: reason,delay=exc.reason,exc.delay
        except (KeyError,IndexError,ValueError,TypeError): reason,delay="Модель не вызвала тестовый инструмент",120
        finally:
            self._finish(lease,key,spec,"probe","проверка",reason if quality>=2 or reason!="ok" else "Проверка прервана",
                         delay,int(1000*(time.monotonic()-start)),quality,"","")

    async def monitor(self):
        # Queue all models sharing one quota. A parallel probe must not starve later keys.
        with self.hub.database() as db:
            last={(r[0],r[1]):r[2] for r in db.execute("""SELECT key_id,model,max(t) FROM hub_events
                  WHERE kind='probe' GROUP BY key_id,model""")}
            routes=sorted(self._rows(db),key=lambda row:last.get((row[2]["key"],row[2]["model"]),0))
        groups={}
        for key,spec,row in routes:
            if row["ready"] and row["checked"]>time.time()-600: continue
            group=(key["provider"],key["account_id"] or "shared")
            groups.setdefault(group,[]).append((row["key"],row["model"]))
        async def probe_group(routes):
            for kid,model in routes:
                await self.probe(kid,model)
        await asyncio.gather(*(probe_group(group) for group in groups.values()))
        with self.hub.database() as db:
            now=int(time.time())
            db.execute("DELETE FROM hub_events WHERE t<?",(now-WINDOW,))
            db.execute("DELETE FROM hub_switches WHERE t<?",(now-WINDOW,))

    async def complete(self,op,choice,request):
        stage="ответ" if request["messages"][-1]["role"]=="tool" else "выбор"
        if choice==PUBLIC:
            # A public question never includes chat history, connection metadata, store data or tool definitions.
            last=request["messages"][-1]
            if last.get("role")!="user" or not isinstance(last.get("content"),str):
                raise direct.Refused("Для публичного вопроса нужен текст пользователя")
            request={"messages":[{"role":"user","content":last["content"]}],"max_tokens":request["max_tokens"]}
        skipped=set(); last_reason=""; deadline=time.monotonic()+82
        while time.monotonic()<deadline-2:
            taken=self._acquire(op,choice,skipped)
            if not taken: break
            lease,key,spec=taken; skipped.add((key["id"],spec["model"]))
            start=time.monotonic(); reason="Запрос прерван"; delay=60
            try:
                async with asyncio.timeout(min(deadline-start,45)):
                    result,usage=await direct.call(self.http,spec,key,request,min(deadline-start,40))
                reason="ok"; delay=0
            except TimeoutError: reason="Тайм-аут"
            except direct.Refused as exc: reason,delay=exc.reason,exc.delay
            finally:
                valid=self._finish(lease,key,spec,"call",stage,reason,delay,int(1000*(time.monotonic()-start)),0,op,last_reason)
            if reason=="ok" and valid:
                return result,usage,spec["model"]
            last_reason=reason if valid else "Настройки ключа изменились"
        raise direct.Refused(last_reason or "Нет проверенного свободного маршрута")


async def monitor(path):
    from .model_hub import Hub,provider_http
    async with provider_http(timeout=40) as http:
        await Runtime(Hub(path),http).monitor()

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--database",required=True)
    asyncio.run(monitor(parser.parse_args().database))
