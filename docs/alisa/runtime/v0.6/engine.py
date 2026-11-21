"""Network-free ingress facade and one-step worker with injectable transport."""
from __future__ import annotations
from dataclasses import asdict
from datetime import date, datetime, timezone
from typing import Callable
from semantics import (Rejected, Scope, Store, parse, make_plan, fingerprint,
                       strict_json, canonical_json, plan_authorized, validate_model)
from repository import Repository, Deferred
import providers

HELP = ('Доступны количество заказанных товаров и сумма заказов. Пример: сводка заказов за октябрь 2026 на Озоне. '
        'Для получения отчета: результат. Для обновления: обнови и исходный запрос.')

class CallError(Exception):
    def __init__(self,code,status=None,unknown=False,retry_at=None):
        self.code,self.status,self.unknown,self.retry_at = code,status,unknown,retry_at
        super().__init__(code)

class Engine:
    def __init__(self,repository: Repository,scope_for: Callable[[str], Scope]):
        self.repo,self.scope_for = repository,scope_for

    def authorized(self,plan):
        try:
            scope = self.scope_for(plan['tenant'])
            if not plan_authorized(plan,scope): return False
            return not any(self.repo.denied(providers.build(plan,s).source,s['access_revision']) for s in plan['stores'])
        except (Rejected,KeyError,TypeError,OSError):
            return False

    def submit(self,tenant,command,request_id,body_hash,today: date):
        scope = self.scope_for(tenant)
        if scope.tenant != tenant: raise Rejected('TENANT_DENIED')
        draft = parse(command,today)
        if draft['route']=='P0': return self.control(tenant,draft['command'])
        selected = scope.select(draft['platforms'])
        frozen = Scope(scope.tenant,scope.revision,selected)
        pre = make_plan(frozen,draft,draft['metrics'] or ['ordered_units'])
        if not self.authorized(pre): raise Rejected('SOURCE_ACCESS')
        draft['scope_snapshot'] = asdict(frozen)
        plan = make_plan(frozen,draft,draft['metrics']) if draft['metrics'] else None
        row,outcome = self.repo.enqueue(tenant,request_id,body_hash,draft,plan,fingerprint(asdict(frozen)))
        answer = self.describe(tenant,row,deliver=True)
        # Only a reminder, never combining old figures into this answer.
        unread = self.repo.unread(tenant,exclude=row['id'])
        if unread and self.authorized(strict_json(unread['plan'])) and len(answer)<740:
            answer += ' Также есть другой готовый непрочитанный отчет.'
        return {'text':answer,'tts':answer,'job_id':row['id'],'state':row['state'],'cache':outcome}

    def describe(self,tenant,row,deliver=False,next_page=False):
        if not row: return HELP
        if row['tenant'] != tenant: raise Rejected('TENANT_DENIED')
        if row['plan'] and not self.authorized(strict_json(row['plan'])):
            return 'Доступ к источнику изменился. Сохраненные цифры не выдаю.'
        state = row['state']
        if state=='READY':
            if (row['expires'] or 0)<=self.repo.clock():
                return 'Отчет устарел. Повторите исходный запрос для нового полного отчета.'
            if not deliver: return 'Отчет готов. Скажите: результат.'
            return self.repo.page(tenant,row['id'],next_page)
        if state in ('QUEUED','RUNNING'):
            wait = max(0,int(row['due']-self.repo.clock()))
            return ('Задание принято. '+(f'Ожидает интервала API, не ранее чем через {wait} секунд. ' if wait>1 else 'Выполняется. ')
                    +'Скажите: результат. Повтор этой команды не запускает новый расчет.')
        if state=='UNKNOWN':
            return 'Исход обращения неизвестен. Повторять его автоматически не буду. Нужна проверка задания.'
        if state=='CANCELLED': return 'Задание отменено. Уже отправленный запрос на стороне площадки отменить нельзя.'
        if state=='FAILED':
            return 'Полный отчет не получен. Частичные суммы не выдаю. Код: '+(row['error'] or 'UNSPECIFIED')+'.'
        return 'Отчет пока недоступен.'

    def control(self,tenant,command):
        if command in ('помощь','помощь аналитики','что ты умеешь'): text=HELP
        elif command=='диагностика аналитики':
            text='Матрица 0.6. Реальные запросы заказанных товаров и суммы заказов включены в тестовом режиме. Очередь и точный кэш. ДРР и прибыль пока не доступны.'
        elif command=='отмени отчет':
            text='Задание отменено.' if self.repo.cancel(tenant) else 'Активного задания для отмены нет.'
        else:
            row=self.repo.get(tenant)
            if command=='план запроса':
                if row and row['plan'] and self.authorized(strict_json(row['plan'])):
                    p=strict_json(row['plan'])
                    text=f"Период с {p['period']['from']} по {p['period']['to']}. Магазинов: {len(p['stores'])}. "+', '.join(p['metrics'])+'. Полный период без дневного дробления.'
                else: text='Доступного сформированного плана нет.'
            else: text=self.describe(tenant,row,deliver=command!='статус отчета',next_page=command=='дальше')
        return {'text':text,'tts':text}

    def safe_submit(self,*args,**kwargs):
        try: return self.submit(*args,**kwargs)
        except Rejected as exc: return {'text':exc.message,'tts':exc.message,'error':exc.code}

class Worker:
    """One HTTP request per step, except a P2 step which only invokes the model.
    No scheduled retries for uncertain outcomes. Queue throttling is not a retry.
    """
    def __init__(self,engine: Engine,transport):
        self.engine,self.repo,self.transport=engine,engine.repo,transport

    def _call(self,row,request,store=None):
        event=self.repo.reserve(row['id'],row['owner'],request.source,request.interval,request.daily_limit)
        try:
            value,meta=self.transport.execute(request,store)
            self.repo.received(event,meta)
            return value
        except CallError as exc:
            self.repo.failed_call(event,exc.status,exc.unknown)
            if exc.retry_at:
                self.repo.defer_source(request.source,max(exc.retry_at,self.repo.clock()+request.interval))
            if store and exc.status in (401,403):
                self.repo.deny(request.source,store['access_revision'])
            raise
        except Exception:
            self.repo.failed_call(event,unknown=True)
            raise CallError('UNEXPECTED_TRANSPORT_OUTCOME',unknown=True) from None

    def step(self):
        row=self.repo.claim()
        if not row: return False
        jid,owner=row['id'],row['owner']
        try:
            draft=strict_json(row['draft'])
            if not row['plan']:
                snapshot=draft['scope_snapshot']
                frozen=Scope(snapshot['tenant'],snapshot['revision'],tuple(Store(**s) for s in snapshot['stores']))
                pre=make_plan(frozen,draft,['ordered_units'])
                if not self.engine.authorized(pre): raise Rejected('SOURCE_ACCESS')
                request=providers.Request('deepseek_parse','model:deepseek-flash','',{'question':draft['question']},2,10)
                response=self._call(row,request)
                metrics=validate_model(response['content'],response['finish_reason'])
                plan=make_plan(frozen,draft,metrics)
                if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
                resolved=self.repo.resolve(jid,owner,plan)
                if resolved['id']==jid:
                    self.repo.reschedule(jid,owner)
                return True
            plan=strict_json(row['plan'])
            if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
            progress=strict_json(row['progress']) if row['progress'] else {'completed':[],'page':None}
            done=progress['completed']
            index=len(done)
            if index>=len(plan['stores']): raise Rejected('PROGRESS_SCHEMA')
            store=plan['stores'][index]
            request=providers.build(plan,store,progress['page'])
            response=self._call(row,request,store)
            result=providers.decode(response,plan,store,progress['page'])
            if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
            if result['complete']:
                result['store_id']=store['id']; result.pop('progress',None)
                done.append(result); progress['page']=None
            else:
                progress['page']=result['progress']
            if len(done)==len(plan['stores']):
                stamp=datetime.fromtimestamp(self.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
                report=providers.render(plan,done,stamp)
                self.repo.complete(jid,owner,report)
            else:
                self.repo.reschedule(jid,owner,progress)
        except Deferred as exc:
            self.repo.reschedule(jid,owner,until=exc.until)
        except CallError as exc:
            if exc.status == 429 and not exc.unknown:
                # HTTP 429 is a known rejection, unlike a transport timeout.
                # Bound all automatic retries and preserve the exact job identity.
                with self.repo.connection() as c:
                    failures = c.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND http=429', (jid,)).fetchone()[0]
                if failures <= 2:
                    pause = 90 * (2 ** (failures - 1))
                    due = max(exc.retry_at or 0, self.repo.clock() + pause)
                    self.repo.reschedule(jid, owner, until=due)
                else:
                    self.repo.fail(jid, owner, 'HTTP_429_RETRY_EXHAUSTED')
            else:
                self.repo.fail(jid,owner,exc.code,exc.unknown)
        except Rejected as exc:
            self.repo.fail(jid,owner,exc.code)
        except Exception:
            self.repo.fail(jid,owner,'WORKER_INTERNAL_UNKNOWN',unknown=True)
        return True
