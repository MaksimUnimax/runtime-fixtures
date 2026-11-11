"""Offline QA only. Decode spoken money for comparison with a hidden oracle.

Not used by the production handler; does not alter any model answer.
Ambiguous/unparsed responses require manual review rather than being a pass.
"""
from decimal import Decimal
import json,re,sys
from pathlib import Path
SMALL={'ноль':0,'нуль':0,'один':1,'одна':1,'одну':1,'одно':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,'шесть':6,
 'семь':7,'восемь':8,'девять':9,'десять':10,'одиннадцать':11,'двенадцать':12,'тринадцать':13,'четырнадцать':14,
 'пятнадцать':15,'шестнадцать':16,'семнадцать':17,'восемнадцать':18,'девятнадцать':19,'двадцать':20,'тридцать':30,
 'сорок':40,'пятьдесят':50,'шестьдесят':60,'семьдесят':70,'восемьдесят':80,'девяносто':90,'сто':100,'двести':200,
 'триста':300,'четыреста':400,'пятьсот':500,'шестьсот':600,'семьсот':700,'восемьсот':800,'девятьсот':900}
SCALE={'тысяча':1000,'тысячу':1000,'тысячи':1000,'тысяч':1000,'миллион':1000000,'миллиона':1000000,'миллионов':1000000}
def number(words):
    total=Decimal(0);part=Decimal(0);sign=1
    for w in words:
        if w=='минус':sign=-1
        elif w=='плюс':pass
        elif w in SMALL:part+=SMALL[w]
        elif w in SCALE:total+=(part or 1)*SCALE[w];part=Decimal(0)
        else:part+=Decimal(w.replace(',','.'))
    return sign*(total+part)
def money(text):
    tokens=re.findall(r'[а-яё]+|[-+]?\d+(?:[,.]\d+)?',text.lower())
    def numeric(w):return w in SMALL or w in SCALE or w in {'минус','плюс'} or re.fullmatch(r'[-+]?\d+(?:[,.]\d+)?',w)
    values=[]
    for i,t in enumerate(tokens):
        if not t.startswith('рубл'):continue
        j=i-1
        while j>=0 and numeric(tokens[j]):j-=1
        if j==i-1:continue
        rub=number(tokens[j+1:i]);kopecks=Decimal(0)
        for k in range(i+1,min(len(tokens),i+7)):
            if tokens[k].startswith('копе'):
                words=tokens[i+1:k]
                if words and words[0]=='и':words=words[1:]
                if words and all(numeric(w) for w in words):kopecks=number(words)
                break
            if not numeric(tokens[k]) and not (k==i+1 and tokens[k]=='и'):break
        values.append(rub+(kopecks/100 if rub>=0 else -kopecks/100))
    return values
def main():
    p=Path(sys.argv[1]);d=json.loads(p.read_text());passed=0;failed=[]
    for c in d['cases']:
        for m,v in c['methods'].items():
            amounts=money(v.get('answer',''));expected=Decimal(c['expected']['amount'])
            correct=v['state']=='COMPLETE' and v.get('selection_correct') and len(amounts)==1 and amounts[0]==expected
            v['numeric_answer_check']={'correct':bool(correct),'parsed_amounts':[str(x) for x in amounts],'expected':str(expected)}
            if correct:passed+=1
            else:failed.append({'case':c['name'],'method':m,'expected':str(expected),'parsed':[str(x) for x in amounts],'answer':v.get('answer','')})
    d['quality_summary']={'correct_numeric_answers':passed,'manual_review_or_wrong':failed}
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(d['quality_summary'],ensure_ascii=False))
if __name__=='__main__':main()
