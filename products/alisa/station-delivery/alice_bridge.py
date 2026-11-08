"""Compatibility facade for the existing authorized Alice webhook branch.
This file reads no provider secrets and makes no external HTTP requests.
Call only AFTER the existing OAuth validation. Keep the existing link flow unchanged.
"""
from __future__ import annotations
import os
from local_gateway import request
from semantics import normalize,Rejected

VERSION='alice-market-matrix-0.9.0-canary'
SOCKET_PATH=os.environ.get('ALISA_MARKET_SOCKET','/run/alice-market/gateway.sock')
LEGACY={'проверка связи','короткий тест','состояние','диагностика','проверка авторизации',
        'длинный тест','проверь отчет','другой вопрос','проверка нейросети','результат дипсика','выход'}

def init_preview():
    # Compatibility name, no storage or network initialization inside web process.
    return None

def handles(command):
    return command not in LEGACY and not command.startswith(('тест дипсика ','тест нейросети '))

def request_result(account,command,request_id,body_hash,today=None,*,conversation_id=None,message_id=None):
    # Compatibility name only; this routes to the actual queue, not a plan preview.
    try:
        if not isinstance(account,str) or not account:
            return {'text':'Для отчета нужна действующая авторизация.','tts':'Для отчета нужна действующая авторизация.'}
        normalize(command)
        return request(SOCKET_PATH,account,command,request_id,body_hash,conversation_id=conversation_id,message_id=message_id)
    except (OSError,TimeoutError,Rejected):
        text = 'Исполнитель аналитики временно недоступен. Повторите запрос; повтор того же сообщения не создаст второе задание.'
        return {'text':text,'tts':text,'error':'IPC_UNAVAILABLE'}


def preview_handle(*args, **kwargs):
    return request_result(*args, **kwargs)['text']
