"""Acceptance-only identity check; never rewrites the product question."""
import re
WORDS={'первого':'1','первое':'1','второго':'2','второе':'2','третьего':'3','третье':'3','четвертого':'4','четвертое':'4','пятого':'5','пятое':'5','шестого':'6','шестое':'6','седьмого':'7','седьмое':'7','восьмого':'8','восьмое':'8','девятого':'9','девятое':'9','десятого':'10','десятое':'10','одиннадцатого':'11','двенадцатого':'12','двенадцатое':'12','озон':'ozon','озоне':'ozon','вайлдберриз':'wb','wildberries':'wb'}
def normalized(value):
 if not isinstance(value,str):return None
 value=value.casefold().replace('ё','е')
 value=re.sub(r'^(?:спроси|попроси|запусти|открой)(?: навык)? октопорт маркет\s*','',value)
 return ' '.join(WORDS.get(word,word)for word in re.findall('[а-яa-z0-9]+',value))
def same_question(actual,expected):return bool(normalized(actual))and normalized(actual)==normalized(expected)
