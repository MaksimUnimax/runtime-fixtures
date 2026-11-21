"""Network-free signed accrual decoder for daily year-on-year qualification.
Negative product accruals are reversals/corrections; no physical-return-date claim.
Not an installed skill handler. All money remains Decimal and source signs persist.
"""
from collections import Counter
from decimal import Decimal
from price_volume import money, SourceError

def decode_page(data, day, seen):
    if not isinstance(data,dict) or not isinstance(data.get('accruals'),list) or not isinstance(data.get('last_id'),str):
        raise SourceError('PAGE_SCHEMA')
    rows=[];controls=Counter()
    for entry in data['accruals']:
        if entry.get('date')!=day: raise SourceError('DATE_AXIS')
        identity=entry.get('accrual_id')
        if type(identity) is not int or identity<=0: raise SourceError('ACCRUAL_ID')
        if identity in seen: raise SourceError('DUPLICATE_ACCRUAL')
        seen.add(identity);controls['records']+=1
        posting=entry.get('posting')
        if posting is None: continue
        products=posting.get('products')
        if not isinstance(products,list): raise SourceError('PRODUCTS_SCHEMA')
        total=Decimal(0)
        for p in products:
            delivery=p.get('delivery')
            if delivery is not None:
                amount=money(delivery['total_accrued'])
                if sum((money(x['accrued']) for x in delivery['services']),Decimal(0))!=amount:
                    raise SourceError('DELIVERY_COMPONENTS')
                total+=amount
            c=p.get('commission')
            if c is None: continue
            q,sku=p.get('quantity'),p.get('sku')
            if type(q) is not int or not 1<=q<=10000: raise SourceError('QUANTITY_SCHEMA')
            if type(sku) is not int or sku<=0: raise SourceError('SKU_SCHEMA')
            f={k:money(c[k]) for k in ('seller_price','sale_price','sale_amount','bonus','coinvestment','sale_commission')}
            if f['seller_price']*q!=f['sale_amount']: raise SourceError('SELLER_UNIT_RECONCILIATION')
            if f['sale_price']+f['bonus']+f['coinvestment']!=f['sale_amount']: raise SourceError('PRICE_LINE_RECONCILIATION')
            direction=1 if f['sale_amount']>0 else -1 if f['sale_amount']<0 else 0
            if direction and f['sale_price']*direction<0: raise SourceError('INCONSISTENT_DIRECTION')
            if not direction: raise SourceError('ZERO_VALUE_MOVEMENT_NOT_QUALIFIED')
            total+=f['sale_amount']+f['sale_commission']
            controls['positive_rows' if direction>0 else 'reversal_rows']+=1
            controls['multi_unit_rows']+=q>1
            rows.append({'date':day,'sku':str(sku),'quantity':q,'direction':direction,'currency':'RUB',
                         **{k:str(v) for k,v in f.items()}})
        if products:
            controls['posting_rows']+=1
            if total!=money(entry['total_amount']): raise SourceError('POSTING_RECONCILIATION')
    return rows,controls

def summarize(rows):
    pos=[x for x in rows if x['direction']>0];neg=[x for x in rows if x['direction']<0]
    def amount(rs,key):return sum((Decimal(x[key]) for x in rs),Decimal(0))
    gross=sum(x['quantity'] for x in pos);reversed_qty=sum(x['quantity'] for x in neg)
    cash=amount(pos,'sale_price');refund=-amount(neg,'sale_price')
    return {'gross_units':gross,'reversal_units':reversed_qty,'net_units':gross-reversed_qty,
            'gross_buyer_amount':str(cash),'reversal_buyer_amount':str(refund),'net_buyer_amount':str(cash-refund),
            'gross_seller_amount':str(amount(pos,'sale_amount')),'reversal_seller_amount':str(-amount(neg,'sale_amount')),
            'mean_buyer_price':str(cash/gross) if gross else None,'distinct_skus':len({x['sku'] for x in pos}),
            'positive_rows':len(pos),'reversal_rows':len(neg)}
