"""Shared recovery for validated read requests and model command formatting."""
from semantics import fingerprint, Rejected

TRANSIENT_STATUS = {408, 425, 429, 500, 502, 503, 504}
TRANSIENT_CODES = {'NETWORK_OUTCOME_UNKNOWN', 'RESPONSE_JSON', 'MODEL_ENVELOPE'}
RATE_LIMIT_RETRY_SECONDS = 20


def repeat_safe(request):
    if request.operation in ('deepseek_parse', 'deepseek_read_plan', 'model_answer','template_select','template_verify'):
        return True
    if request.operation.startswith('read.'):
        from read_surface import method, available
        _, platform, operation = request.operation.split('.', 2)
        return available(method(platform, operation))
    from http_transport import MATRICES
    # These closed matrices expose analytics reads and temporary token grants.
    # Report generation may repeat after a lost reply, but never a business write.
    return request.operation in MATRICES


def retry_due(repo, row, request, error, safe):
    transient = error.status in TRANSIENT_STATUS or error.code in TRANSIENT_CODES
    if not safe or not transient:
        return None
    if error.status == 429:
        return max(error.retry_at or 0, repo.clock()+max(request.interval, RATE_LIMIT_RETRY_SECONDS))
    with repo.connection() as c:
        last_ok = c.execute("SELECT COALESCE(MAX(id),0) FROM calls WHERE jid=? AND source=? AND state='RECEIVED'", (row['id'], request.source)).fetchone()[0]
        failures = c.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND source=? AND id>?', (row['id'], request.source, last_ok)).fetchone()[0]
    delay = min(2 * 2 ** min(max(failures-1, 0), 9), 60)
    return max(error.retry_at or 0, repo.clock()+max(request.interval, delay))


def compiler_decision(response, draft, progress):
    from query_program import validate_model_program
    raw, finish = response.get('content'), response.get('finish_reason')
    try:
        return validate_model_program(raw, finish, draft)
    except Rejected as error:
        if error.code not in {
            'LLM_JSON','LLM_SCHEMA','LLM_INCOMPLETE','OUTPUT_LIMIT','GRAPH_LIMIT',
            'EXPRESSION_SCHEMA','EXPRESSION_REFERENCE','PERIOD_REFERENCE','UNKNOWN_METRIC',
            'UNKNOWN_OPERATOR','OPERATOR_ARITY','MIXED_TIME_AXES','UNIT_MISMATCH',
            'TIME_BASIS_MISMATCH','INCOMPARABLE_PERIOD_EXPRESSIONS','RATE_BASIS_MISMATCH',
            'DUPLICATE_ADDITIVE_COMPONENT','OVERLAPPING_ADDITIVE_COMPONENTS',
            'OVERLAPPING_COST_COMPONENTS','OVERLAPPING_ORDER_COMPONENTS','OVERLAPPING_AD_COMPONENTS',
            'RATIO_PERIOD_MISMATCH','PERCENT_UNIT_MISMATCH','PER_DAY_TIME_BASIS','UNIT_COMPLEXITY'}:
            raise
        state = fingerprint({'content':raw, 'finish':finish, 'feedback':progress.get('compiler_feedback')})
        seen = progress.setdefault('compiler_format_states', [])
        if state in seen:
            raise Rejected('READ_NO_PROGRESS') from None
        seen.append(state)
        progress['compiler_feedback'] = {
            'code':error.code,
            'instruction':'Исправьте формат: верните один полный JSON без комментариев. Сохраните исходный вопрос и все условия. Не подставляйте вымышленные показатели.',
            'required_fields':['expressions','fully_understood','unsupported']}
        if error.code not in {'LLM_JSON','LLM_SCHEMA','LLM_INCOMPLETE'}:
            progress['compiler_feedback']['instruction']='Исправьте выражение по указанной ошибке и исходному каталогу. Сохраните все условия вопроса. Если корректно выразить запрос нельзя, верните fully_understood=false и unsupported=true; не заменяйте показатель похожим.'
        return None
