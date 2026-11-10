"""Lossless input-only encoding. No provider calls, caches or tokenizers.

Version 1 is immutable: jobs pin it before first dispatch and rebuild from their
existing API data on retries. Retain old encoders while their jobs can resume.
"""
from semantics import canonical_json

CURRENT_VERSION = 1
MIN_CHARACTERS = 10_000
PREFIX = 'Данные API по этому вопросу:\n'
V1_INSTRUCTION = (
    'Формат данных: schemas содержит списки имён полей. Каждый объект исходных данных '
    'записан как {"@":N,"v":[значения]}: N — индекс схемы, начиная с нуля; значения '
    'соответствуют её полям по порядку. Это правило действует и для вложенных объектов. '
    'Массивы сохраняют порядок и все повторяющиеся элементы; строки, числа, true, false '
    'и null переданы без изменения. Корень исходных данных находится в data.\n'
)


def pack_v1(value):
    """Describe each object shape once; retain every value and array occurrence."""
    schemas, indices = [], {}

    def encode(item):
        if type(item) is dict:
            keys = tuple(sorted(item))
            if keys not in indices:
                indices[keys] = len(schemas)
                schemas.append(list(keys))
            return {'@': indices[keys], 'v': [encode(item[k]) for k in keys]}
        if type(item) is list:
            return [encode(child) for child in item]
        return item

    data = encode(value)
    return {'schemas': schemas, 'data': data}


def content(value, version=0):
    raw = canonical_json(value)
    original = PREFIX + raw
    if version != 1 or len(raw) < MIN_CHARACTERS:
        return original
    try:
        packed = PREFIX + V1_INSTRUCTION + canonical_json(pack_v1(value))
    except RecursionError:
        # Encoding adds stack depth; use the already serialized original.
        return original
    return packed if len(packed) < len(original) else original
