"""Journal UI in the existing disposable staff/MFA/PostgreSQL browser fixture."""
import hashlib,importlib.util,json,time
from pathlib import Path
from playwright.sync_api import expect


def run(page,origin,db,check,record):
    def phase(name):record["query_insights_browser_phase"]=name
    phase("seeding")
    path=Path(__file__).resolve().parents[2]/'services/platform/src/alisa_platform/query_insights/wire.py'
    spec=importlib.util.spec_from_file_location('gap_browser_wire',path);wire=importlib.util.module_from_spec(spec);spec.loader.exec_module(wire)
    ids=[];events=[]
    for i in range(160):
        event=wire.make_event(b'synthetic-browser-fixture-key-32!','synthetic-client',str(i),time.time(),
            'MODEL_NO_TEMPLATE','a'*64,{'runtime_release':'fixture-browser','original_question':'Покажи выкупы не из заказов за вчера'})
        event['final_outcome']='UNSUPPORTED';ids.append(event['event_id']);events.append(event)
    with db('platform')as conn:
        for event in events:
            conn.execute('INSERT INTO query_insights_episode(id,tenant_pseudonym,logical_query_id,revision,revision_hash,producer,event,reason,outcome,internal_test,occurred_at,received_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,false,now(),now())',
                [event['event_id'],event['tenant_pseudonym'],event['logical_query_id'],1,hashlib.sha256(wire.canonical(event).encode()).hexdigest(),'analytics_runtime',json.dumps(event),event['reason_code'],event['final_outcome']])
    with db('platform')as conn:count=conn.execute('SELECT count(*) FROM query_insights_episode WHERE id=ANY(%s::uuid[])',[ids]).fetchone()[0]
    check('s08_committed_browser_fixture_rows',count==160)
    try:
        phase('loading')
        with page.expect_response(lambda r:r.url==origin+'/api/staff/query-insights'and r.request.method=='POST')as got:
            page.goto(origin+'/admin/query-insights')
        response=got.value;body=response.json()
        check('s08_packaged_journal_api_items',response.status==200 and 0<len(body.get('items',[]))<=100)
        phase('initial_text')
        expect(page.get_by_role('heading',name='Журнал вопросов',exact=True)).to_be_visible()
        expect(page.get_by_text('За выбранный период данные могут быть неполными.',exact=True)).to_be_visible()
        expect(page.get_by_text(events[0]['safe_utterance'],exact=True).first).to_be_visible()
        phase('reason_filter')
        page.get_by_label('Причина',exact=True).select_option('AUTH_OR_SCOPE');page.get_by_role('button',name='Показать',exact=True).click()
        expect(page.get_by_text('За выбранный период записей пока нет.',exact=True)).to_be_visible()
        page.get_by_label('Причина',exact=True).select_option('SEMANTIC_UNSUPPORTED');page.get_by_role('button',name='Показать',exact=True).click()
        expect(page.get_by_text(events[0]['safe_utterance'],exact=True).first).to_be_visible()
        phase('export')
        seen=set();parts=0
        while True:
            name='Скачать очищенную выборку'if parts==0 else'Скачать следующую часть'
            with page.expect_download()as got:page.get_by_role('button',name=name,exact=True).click()
            value=json.loads(Path(got.value.path()).read_text());part={x['event_id']for x in value['items']}
            if got.value.failure()or not part or seen&part:raise AssertionError('Invalid safe export page')
            seen|=part;parts+=1
            if not value['has_more']:break
            if parts>5:raise AssertionError('Export did not terminate')
            expect(page.get_by_role('button',name='Скачать следующую часть',exact=True)).to_be_enabled()
        check('s08_packaged_staff_journal_filters_incomplete_and_export_continuation',seen==set(ids)and parts>1)
    finally:
        with db('platform')as conn:conn.execute('DELETE FROM query_insights_episode WHERE id=ANY(%s::uuid[])',[ids])
    phase('complete')
    page.goto(origin+'/admin')
