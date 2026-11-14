"""Station callback grammar shared by ingress and its client; no business routing."""
import re

def internal_voice_command(value):
    if not isinstance(value, str): return None
    command=' '.join(value.lower().replace('ё','е').strip(' .!?').split())
    command=re.sub(r'^(?:спроси|попроси|запусти|открой)(?: навык)? октопорт маркет ', '', command)
    if re.fullmatch(r'доставка (?:[0-9] ?){7}[0-9]',command):
        return 'доставка '+''.join(command[9:].split())
    if re.fullmatch(r'привязать колонку(?: [0-9 ]+)?',command):return command
    return None
