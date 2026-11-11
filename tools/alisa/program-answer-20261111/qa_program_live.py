"""One paid answer-stage smoke on synthetic data; no marketplace/voice calls."""
from pathlib import Path
from types import SimpleNamespace
import json,tempfile,uuid
from decimal import Decimal
from repository import Repository
from engine import Worker
from http_transport import HTTPTransport
from model_program import run,selected
from model_usage import job_attempts,price_attempt
from semantics import canonical_json

def main():
    case=json.loads(Path(__file__).with_name('qa_program_live_input.json').read_text())
    data=dict(case['data'],template_context={'notes':case['notes']})
    assert selected(data)
    with tempfile.TemporaryDirectory(prefix='program-live-',dir='/var/lib/alice-market')as temp:
        repo=Repository(Path(temp)/'qa.sqlite');jid=uuid.uuid4().hex;owner=uuid.uuid4().hex;tenant='qa-program-live'
        with repo.connection(True)as c:c.execute('INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            (jid,tenant,jid,'RUNNING',canonical_json({'original_question':case['question'],'runtime_guard':None}),'{}',repo.clock(),repo.clock(),repo.clock(),owner,repo.clock()+repo.lease))
        row=repo.get(tenant,jid);engine=SimpleNamespace(repo=repo,authorize_job=lambda r:None,report_archive=None)
        worker=Worker(engine,HTTPTransport('/run/credentials/alice-market.service',{}, {},enabled=True))
        settings=json.loads(Path('/var/lib/alice-market/answer-settings.json').read_text())
        rule=' Кратко ответь только на вопрос пользователя. Оставь лишь запрошенные сведения. Не озвучивай ход вычислений, технические подробности и пути файлов. Не добавляй причины и объяснения, которых нет в полученных данных.'
        msgs=[{'role':'system','content':settings['answer_prompt']+rule}]
        if settings['answer_extra_instruction'].strip():msgs.append({'role':'system','content':settings['answer_extra_instruction']})
        msgs.extend([{'role':'user','content':case['question']},{'role':'user','content':'data-file'}])
        result=run(worker,row,msgs,data)
        attempts=job_attempts(repo,jid)
        costs=[price_attempt(a['receipt'],input_cached='.006',input_uncached='.3',output='1.2',rub_per_currency='82.5486')for a in attempts]
        assert all(c is not None for c in costs)
        evidence={'answer':result['content'],'expected':case['expected'],'calls':len(attempts),'cost_rub':str(sum(Decimal(c['rub'])for c in costs)),
                  'input_characters':len(canonical_json(data)),'marketplace_calls':0,'station_calls':0,'provider_attempts':[{k:a[k]for k in ['state','dispatched','receipt','context']}for a in attempts]}
        Path('/var/lib/alice-market/program-live-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
        print(json.dumps(evidence,ensure_ascii=False))
if __name__=='__main__':main()
