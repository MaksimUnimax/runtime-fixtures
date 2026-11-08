"""Offline QA registry validator/board generator. No network or runtime writes.
Process roles are metadata, not a substitute for Git permissions/approval.
"""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path,PurePosixPath
BUG_STATES={'NEW','TRIAGED','REPRODUCED','IN_DEVELOPMENT','READY_FOR_RETEST','VERIFIED','CLOSED','BLOCKED','DUPLICATE','NOT_A_BUG'}
TEMPLATE_STATES={'NEW','TRIAGED','CANDIDATE','SPECIFIED','IN_DEVELOPMENT','VALIDATING','RELEASED','MONITORING','CLOSED','BLOCKED','DECLINED'}
KINDS={'BUG','CAPABILITY_GAP','PROVIDER_ERROR','PROVIDER_FORMAT','PREVENTED','ACCEPTANCE_RULE','LIMITATION','RESEARCH_FIX','RESEARCH_TOOLING'}
CHANGES={'SYNONYM','FORMULA_FROM_EXISTING','SOURCE_BINDING','GENERAL_OPERATOR','BUG','PROVIDER_WAIT'}
REASONS={'P1_MISS_P2_SUCCESS','SEMANTIC_UNSUPPORTED','OPERATOR_UNSUPPORTED','NEEDS_CLARIFICATION','AMBIGUOUS_STORE_OR_PERIOD','DATA_UNAVAILABLE','PROVIDER_PLAN_REQUIRED','AUTH_OR_SCOPE','SERVICE_ACCESS_REQUIRED','RATE_LIMIT_OR_PROVIDER_ERROR','PARSER_OR_RUNTIME_BUG','SECURITY_OR_ABUSE','WRONG_SEMANTICS'}
HEX=re.compile(r'^[a-f0-9]{64}$');COMMIT=re.compile(r'^[a-f0-9]{40}$')
class CheckError(ValueError):pass

def need(ok,code):
    if not ok:raise CheckError(code)

def load(path):
    def unique(pairs):
        d={}
        for k,v in pairs:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
        return d
    return json.loads(path.read_text(),object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(CheckError('NONFINITE')))

def safe_path(text):
    p=PurePosixPath(text);need(not p.is_absolute() and '..' not in p.parts and text.startswith('docs/alisa/'),'UNSAFE_SOURCE_PATH')

def source(ref,manifest):
    need(type(ref)is dict and set(ref)=={'path','commit','sha256','line_start','line_end'},'SOURCE_SCHEMA')
    safe_path(ref['path']);need(bool(COMMIT.fullmatch(ref['commit'])) and bool(HEX.fullmatch(ref['sha256'])),'SOURCE_IDENTITY')
    need(type(ref['line_start'])is int and type(ref['line_end'])is int and 1<=ref['line_start']<=ref['line_end'],'SOURCE_LINES')
    origins={x['path']:x for x in manifest['original_files']}
    if ref['commit']==manifest['source_commit']:need(ref['path'] in origins and ref['sha256']==origins[ref['path']]['sha256'],'IMPORTED_SOURCE_MISMATCH')

def index(data,schema):
    need(data.get('schema')==schema and type(data.get('records'))is list,'REGISTRY_SCHEMA');out={}
    for row in data['records']:
        need(type(row)is dict and isinstance(row.get('id'),str) and re.fullmatch(r'[A-Za-z0-9_-]{1,160}',row['id']),'RECORD_ID')
        need(row['id'] not in out,'DUPLICATE_RECORD_ID');out[row['id']]=row
    return out

def check(root,source_root=None):
    manifest=load(root/'IMPORT_MANIFEST.json')
    need(manifest['schema']=='alisa-qa-import/v1' and bool(HEX.fullmatch(manifest['archive_sha256'])),'IMPORT_SCHEMA')
    bugs=index(load(root/'BUGS.json'),'alisa-qa-findings/v1');templates=index(load(root/'TEMPLATES.json'),'alisa-qa-candidates/v1');runs=index(load(root/'RUNS.json'),'alisa-qa-runs/v1')
    for b in bugs.values():
        need(b['state'] in BUG_STATES and b['kind'] in KINDS and b['severity'] in {'P0','P1','P2','P3','UNSET'},'FINDING_STATE')
        need(type(b['revision'])is int and b['revision']>=1,'RECORD_REVISION');source(b['source'],manifest)
        need(b['reason_class'] in REASONS,'REASON_UNKNOWN');need(set(b['linked_templates'])<=templates.keys(),'TEMPLATE_REFERENCE')
        if b['state'] in ('READY_FOR_RETEST','VERIFIED','CLOSED') and b['kind']=='BUG':need(bool(b['fix_commit']) and bool(COMMIT.fullmatch(b['fix_commit'])),'FIX_PROOF_REQUIRED')
        if b['state'] in ('VERIFIED','CLOSED'):
            need(b['retest_run_id'] in runs,'RETEST_REQUIRED');r=runs[b['retest_run_id']]
            need(r.get('outcome')=='PASS' and r.get('current_release_acceptance') is True,'CURRENT_RETEST_REQUIRED')
    for tid,t in templates.items():
        need(t['state'] in TEMPLATE_STATES and t['change_class'] in CHANGES,'TEMPLATE_STATE');source(t['source_spec'],manifest)
        safe_path(t['candidate_path']);need(HEX.fullmatch(t['candidate_sha256']),'CANDIDATE_IDENTITY')
        need(set(t['dependencies'])<=templates.keys() and tid not in t['dependencies'],'DEPENDENCY_REFERENCE');need(set(t['linked_findings'])<=bugs.keys(),'FINDING_REFERENCE')
        need(type(t['runtime_enabled'])is bool,'TEMPLATE_ENABLED_TYPE');need(type(t['revision'])is int and t['revision']>=1,'RECORD_REVISION');need(type(t['proofs'])is list,'PROOFS_TYPE')
        for proof in t['proofs']:need(set(proof)=={'id','level','sha256','scope'} and proof['level'] in {'SOURCE_TEST','INTEGRATION_FIXTURE','RECORDED_PROVIDER','LIVE_PROVIDER','LIVE_DIALOGS'} and HEX.fullmatch(proof['sha256']),'PROOF_SCHEMA')
        if t['state'] in {'SPECIFIED','IN_DEVELOPMENT','VALIDATING','RELEASED','MONITORING','CLOSED'}:need(bool(t.get('independent_gold_ref')) and bool(t.get('answer_contract_ref')),'SPEC_EVIDENCE_REQUIRED')
        if t['runtime_enabled'] or t['state'] in {'RELEASED','MONITORING','CLOSED'}:
            need(not t['blockers'] and bool(t['runtime_release']) and bool(t['approval_ref']) and bool(t['proofs']),'RELEASE_PROOF_REQUIRED');need(t['approved_hash']==t['candidate_sha256'],'APPROVED_HASH_MISMATCH')
        elif t['approved_hash'] is not None:need(t['approved_hash']==t['candidate_sha256'] and bool(t['approval_ref']),'APPROVED_HASH_MISMATCH')
    def walk(tid,stack):
        need(tid not in stack,'DEPENDENCY_CYCLE')
        for child in templates[tid]['dependencies']:walk(child,stack|{tid})
    for tid in templates:walk(tid,set())
    for r in runs.values():
        source(r['source'],manifest)
        if r.get('claims')=='SOURCE_REPORTED_NOT_RERUN':need(r['current_release_acceptance'] is False,'HISTORICAL_NOT_CURRENT')
    if source_root is not None:
        for item in manifest['original_files']:
            safe_path(item['path']);p=source_root/item['path'];need(p.is_file(),'SOURCE_FILE_MISSING');need(hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],'SOURCE_BYTES_CHANGED')
    for path in root.glob('*.json'):
        text=path.read_text();need(not re.search(r'(?:Bearer\s+[A-Za-z0-9_-]{24,}|sk-proj-[A-Za-z0-9_-]{20,}|"(?:access_token|execution_ticket|client_secret)"\s*:\s*"[^"\n]{12,}")',text),'POSSIBLE_SECRET')
    return {'status':'PASS','findings':len(bugs),'candidates':len(templates),'source_reports':len(runs),'source_files':len(manifest['original_files']),'enabled_candidates':sum(t['runtime_enabled'] for t in templates.values()),'network_calls':0}

def transition(before,after):
    old={r['id']:r for r in before['records']};new={r['id']:r for r in after['records']};need(old.keys()<=new.keys(),'RECORD_REMOVAL_FORBIDDEN')
    for key,row in old.items():
        n=new[key]
        for field in ('source','source_spec','source_excerpt','source_reported_status','reported_outcome'):
            if field in row:need(row[field]==n.get(field),'HISTORICAL_SOURCE_REWRITE')
        if row!=n:need(n['revision']>row['revision'],'REVISION_NOT_INCREASED')
        if row.get('candidate_sha256')!=n.get('candidate_sha256'):
            need(n.get('approved_hash')is None and n.get('approval_ref')is None,'STALE_APPROVAL_AFTER_EDIT');need(n.get('runtime_enabled')is False and n['state'] not in {'RELEASED','MONITORING','CLOSED'},'EDIT_REQUIRES_REVIEW')
        if row.get('state') not in {'READY_FOR_RETEST','VERIFIED','CLOSED'} and n.get('state')=='CLOSED':need(False,'SKIPPED_RETEST')
    return True

def render(root):
    stats=check(root);bugs=load(root/'BUGS.json')['records'];templates=load(root/'TEMPLATES.json')['records'];runs=load(root/'RUNS.json')['records'];esc=lambda s:str(s).replace('|','/').replace('\n',' ')
    lines=['# Общая доска тестера и автора матрицы','','**Генерируется из BUGS.json, TEMPLATES.json, RUNS.json. Не редактировать статусы вручную здесь.**','',f"Импорт: {stats['candidates']} кандидатов; {stats['findings']} записей разных типов; {stats['source_reports']} протоколов. Включённых импортированных кандидатов: **{stats['enabled_candidates']}**.",'','## Кандидаты','','| ID | Название | Этап | Зависимости | Блокеры |','|---|---|---|---|---|']
    progress=root/'CATALOG_PROGRESS_CURRENT.json'
    if progress.exists():
        counts=load(progress)
        lines[5:5]=[f"Текущий каталог: **{counts['implemented_total']} реализовано / {counts['enabled_total']} включено**. Шесть импортированных CASE не являются размером всего каталога. [Точная версия и ограничения](CATALOG_PROGRESS_CURRENT.json).",'']
    for t in templates:lines.append('| '+' | '.join(esc(x) for x in [t['id'],t['title'],t['state'],', '.join(t['dependencies']) or '—',', '.join(t['blockers'])])+' |')
    lines+=['','## Дефекты и наблюдения','','TRIAGED означает разбор материалов, не повторную проверку текущего сервиса. Исторический исход хранится отдельно.','','| ID | Тип | Severity источника | Наблюдение | Исторический исход | Сейчас | Точная прежняя проверка |','|---|---|---|---|---|---|---|']
    for b in bugs:lines.append('| '+' | '.join(esc(x) for x in [b['id'],b['kind'],b['severity'],b['title'],b['reported_outcome'],b['state']+' / '+b['current_runtime_retest'], (b.get('historical_verification') or {}).get('target_build','—')+' / '+(b.get('historical_verification') or {}).get('outcome','—')])+' |')
    lines+=['','## Исходные журналы','','| Журнал | Тип | Сборка | Значение |','|---|---|---|---|']
    for r in runs:lines.append('| '+' | '.join(esc(x) for x in [r['source']['path'],r['kind'],r['observed_build'],r.get('outcome','Источник')+'; '+('приёмка указанной версии' if r.get('current_release_acceptance') else 'не приёмка текущего выпуска')])+' |')
    lines+=['','## Следующий пакет','','Следующий исполняемый пакет и его зависимости определяет [актуальный README](README.md). Эта доска не назначает прежний RT-CAT вместо текущей работы. READY_FOR_RETEST требует отдельной проверки указанной версии; прежние PASS не переносятся на новый выпуск. Исторические FAIL и числовые PARTIAL/SKIP сохраняются. Никаких новых HTTP ради переоформления журналов.','']
    (root/'BOARD.md').write_text('\n'.join(lines))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--source-root',type=Path);p.add_argument('--render',action='store_true');p.add_argument('--check',action='store_true');p.add_argument('--before',type=Path);p.add_argument('--after',type=Path);a=p.parse_args()
    try:
        if a.before or a.after:need(a.before is not None and a.after is not None,'BOTH_CHANGE_FILES_REQUIRED');transition(load(a.before),load(a.after))
        result=check(a.root,a.source_root)
        if a.render:render(a.root)
        print(json.dumps(result,ensure_ascii=False))
    except (CheckError,KeyError,TypeError,ValueError,OSError) as exc:
        print(json.dumps({'status':'FAIL','reason':str(exc)},ensure_ascii=False));raise SystemExit(1)
