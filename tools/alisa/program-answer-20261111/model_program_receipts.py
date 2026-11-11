"""Provider receipts only, shared with the independently audited laboratory parser."""
import json,codecs
def usage_complete(usage, path):
    if not isinstance(usage, dict):
        return False
    def integer(value):
        return type(value) is int and value >= 0
    if path.endswith('chat/completions'):
        keys = ('prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens')
        if not all(integer(usage.get(k)) for k in keys):
            return False
        if usage['prompt_tokens'] != usage['prompt_cache_hit_tokens'] + usage['prompt_cache_miss_tokens']:
            return False
        if 'total_tokens' in usage and (not integer(usage['total_tokens']) or usage['total_tokens'] != usage['prompt_tokens'] + usage['completion_tokens']):
            return False
        details = usage.get('prompt_tokens_details', {})
        output_details = usage.get('completion_tokens_details', {})
        if not isinstance(details, dict) or not isinstance(output_details, dict): return False
        alternate = details.get('cached_tokens')
        reason = output_details.get('reasoning_tokens')
        if reason is not None and (not integer(reason) or reason > usage['completion_tokens']): return False
        return alternate is None or (integer(alternate) and alternate == usage['prompt_cache_hit_tokens'])
    return all(integer(usage.get(k)) for k in ('input_tokens', 'cache_read_input_tokens',
                  'cache_creation_input_tokens', 'output_tokens')) and usage['cache_creation_input_tokens'] == 0

def receipts(raw, path):
    """Preserve provider usage fields without guessing absent token counts."""
    if path.endswith("chat/completions"):
        obj = json.loads(raw)
        if not isinstance(obj, dict): raise ValueError('Invalid provider envelope')
        choices = obj.get("choices", [])
        if not isinstance(choices, list) or (choices and not isinstance(choices[0], dict)):
            raise ValueError('Invalid provider choices')
        finish = choices[0].get("finish_reason") if choices else None
        return {"id": obj.get("id"), "model": obj.get("model"), "usage": obj.get("usage"),
                "usage_complete": usage_complete(obj.get('usage'), path),
                "response_complete": finish is not None, "finish_reason": finish}
    usage, ident, model, finish, stopped = None, None, None, None, False
    # An SSE event can contain multiple data lines. Ignore a trailing partial
    # frame: it has not yet been dispatched by the SSE framing protocol.
    normalized = codecs.getincrementaldecoder('utf-8')().decode(raw, final=False).replace('\r\n', '\n').replace('\r', '\n')
    for frame in normalized.split('\n\n')[:-1]:
        data = '\n'.join(line[5:].removeprefix(' ') for line in frame.split('\n') if line.startswith('data:'))
        if not data:
            continue
        event = json.loads(data)
        if not isinstance(event, dict): raise ValueError('Invalid SSE envelope')
        message = event.get("message", {})
        if not isinstance(message, dict): raise ValueError('Invalid SSE message')
        ident = message.get("id", ident)
        model = message.get("model", model)
        if event.get("type") == "message_delta" and event.get("usage") is not None:
            usage = event["usage"]
            delta = event.get('delta', {})
            if not isinstance(delta, dict): raise ValueError('Invalid SSE delta')
            finish = delta.get("stop_reason")
        if event.get("type") == "message_stop":
            stopped = True
    return {"id": ident, "model": model, "usage": usage,
            "usage_complete": usage_complete(usage, path),
            "response_complete": stopped, "finish_reason": finish}

