"""Server-side meaning constraints independent of model confidence and JSON validity.
No I/O, credentials or network. Does not silently choose a definition of sales.
"""
import re
import unicodedata
from registry import DEFINITIONS
from semantic_catalog import EXPRESSION_CATALOG, SPEECH_CATALOG

POLICY_VERSION = 'sales-basis-20261103-r1'
CLARIFICATION = ('Что считать продажами: сумму и количество заказанных товаров или выкупы? '
                 'Финансовую реализацию без отдельного указания не подставляю. '
                 'Для заказов скажите: сводка заказов за вчера.')

def basis_text(text):
    text = unicodedata.normalize('NFKC', str(text)).casefold().replace('ё', 'е')
    # Hide quoted literals: a brand name is not an authorization to choose finance.
    text = re.sub(r'"[^"\n]*"|«[^»\n]*»', ' ', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Cf')
    text = re.sub(r'\s+', ' ', text).strip()
    # Recognize a missing word separator only in a known imperative/domain pair.
    # This view is for semantic checks; original question/IDs/filters stay unchanged.
    prefixes = r'(?:дай(?:те)?|покажи(?:те)?|скажи(?:те)?|выведи(?:те)?|сколько|алиса)'
    roots = r'(?:продаж|продал|продан|выручк|оборот|финансов)'
    return re.sub(r'(?<!\w)(' + prefixes + r')(?=' + roots + r')', r'\1 ', text)

def explicit_financial_basis(text, catalog=None):
    text = basis_text(text)
    if re.search(r'\bфинансов\w*\s+(?:продаж\w*|реализац\w*|сводк\w*|отчет\w*|источник\w*)\b', text):
        return True
    if re.search(r'\b(?:продаж\w*|реализац\w*)\s+по\s+финансов\w*\s+(?:отчет\w*|источник\w*)\b', text):
        return True
    catalog = catalog or EXPRESSION_CATALOG
    def contains_finance(name, seen=()):
        if name == 'finance_sales': return True
        if name in seen: return False
        definition = catalog.get('formulas', {}).get(name)
        if not definition: return False
        def walk(e):
            if not isinstance(e, dict): return False
            if 'metric' in e or 'template' in e:
                return contains_finance(e.get('metric', e.get('template')), seen + (name,))
            return any(walk(x) for x in e.get('args', []))
        return walk(definition['expr'])
    # An approved named formula may legitimately require finance_sales.
    phrases = [(p, [m]) for m, ps in SPEECH_CATALOG['phrases'].items() for p in ps]
    phrases += list(SPEECH_CATALOG['bundles'].items())
    for phrase, metrics in phrases:
        if any(contains_finance(m) for m in metrics) and re.search(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', text):
            return True
    return False

def sales_ambiguous(text):
    t = basis_text(text)
    # Qualifiers attach to the specific sales mention, not to the whole request.
    # "продажи и финансовая сводка" still contains an unresolved first metric.
    patterns = [
        r'\bфинансов\w*\s+(?:продаж\w*|реализац\w*|выручк\w*)\b',
        r'\b(?:продаж\w*|реализац\w*|выручк\w*)\s+(?:по|из)\s+финансов\w*\s+(?:отчет\w*|источник\w*)\b',
    ]
    for pattern in patterns: t = re.sub(pattern, ' ', t)
    return bool(re.search(r'\b(?:продаж\w*|продал(?:и|а)?|продан\w*|выручк\w*|товарооборот\w*)\b', t))

def validate_request_basis(draft, plan):
    from semantics import Rejected
    if 'finance_sales' in plan.get('metrics', []) and not explicit_financial_basis(draft.get('question', ''), draft.get('catalog_pin')):
        raise Rejected('FINANCIAL_BASIS_NOT_REQUESTED', CLARIFICATION)
