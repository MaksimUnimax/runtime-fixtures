/** Lossless owner facts editor. No inferred costs, taxes, or date allocation. */
export type State='VALUE'|'NOT_PROVIDED'|'EXCLUDED_BY_OWNER';
export type Field='unit_cost'|'tax_amount'|'own_cost_amount';
export type Entry={id:string;field:Field;entity:string;currency:'RUB';period:{from:string;to:string}|null;state:State;value:string|null};
export type Facts={product_map:Record<string,string>;entries:Entry[]};
export type Row={id:string;field:Field;sku:string;scope?:'all'|'product';from:string;to:string;state:State;amount:string};
export type RecordState={store_id:string;revision:number;status:'NOT_PROVIDED'|'APPROVED'|'REVOKED';facts:Facts|null;approval_id?:string|null};
export type Pending={id:string;store:string;deadline:number;revision:number;action:'approve'|'revoke'};
export const labels:Record<Field,string>={unit_cost:'Себестоимость за единицу',tax_amount:'Налог за период',own_cost_amount:'Собственные расходы за период'};
export function amount(value:string):string{
  const result=value.trim().replace(',','.');
  if(!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/.test(result))throw new Error('Введите неотрицательную сумму без пробелов и разделителей тысяч. Ноль укажите явно.');
  return result;
}
export type RowInput='sku'|'from'|'to'|'amount'|'state';
export class RowValidationError extends Error{
  rowId:string;field:RowInput;
  constructor(rowId:string,field:RowInput,message:string){super(message);this.name='RowValidationError';this.rowId=rowId;this.field=field;}
}
export function date(value:string):string{
  // Pure calendar validation: no UTC/local conversion and no RangeError for bad input.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Введите полную дату: день, месяц и четырёхзначный год.');
  const [year,month,day]=value.split('-').map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1])throw new Error('Такой даты нет в календаре. Проверьте день, месяц и год.');
  return value;
}
function rowDate(row:Row,index:number,field:'from'|'to'):string{
  const label=field==='from'?'начала':'окончания';
  if(!row[field])throw new RowValidationError(row.id,field,`Строка ${index+1}: укажите дату ${label}. Выберите её в календаре или заполните день, месяц и год.`);
  try{return date(row[field]);}catch(error){throw new RowValidationError(row.id,field,`Строка ${index+1}, дата ${label}: ${error instanceof Error?error.message:'Проверьте дату.'}`);}
}
export function toFacts(rows:Row[],store:string):Facts{
  if(!/^[0-9a-f-]{36}$/i.test(store)||rows.length<1||rows.length>200)throw new Error('Выберите магазин и добавьте от 1 до 200 строк.');
  const product_map:Record<string,string>={};const seen=new Set<string>();
  const entries:Entry[]=rows.map((row,index)=>{
    if(!Object.hasOwn(labels,row.field)||seen.has(row.id)||!/^[-a-zA-Z0-9_:]{1,100}$/.test(row.id))throw new Error('Некорректная строка параметров.');seen.add(row.id);
    let entity='store:'+store;
    if(row.field==='unit_cost'&&row.scope==='all'){entity='all-products';}
    else if(row.field==='unit_cost'){
      if(!/^[1-9]\d{0,19}$/.test(row.sku))throw new RowValidationError(row.id,'sku',`Строка ${index+1}: выберите товар из каталога магазина для индивидуальной себестоимости.`);
      entity='sku:'+row.sku;product_map[row.sku]=entity;
    }
    if(!['VALUE','NOT_PROVIDED','EXCLUDED_BY_OWNER'].includes(row.state)||(row.state==='EXCLUDED_BY_OWNER'&&row.field!=='tax_amount'))throw new RowValidationError(row.id,'state',`Строка ${index+1}: исключение владельцем допустимо только для налога.`);
    let period:{from:string;to:string}|null=null;
    if(row.field!=='unit_cost'){
      const from=rowDate(row,index,'from'),to=rowDate(row,index,'to');
      if(from>to)throw new RowValidationError(row.id,'to',`Строка ${index+1}: дата окончания не может быть раньше даты начала.`);
      period={from,to};
    }
    let value:string|null=null;
    if(row.state==='VALUE'){
      try{value=amount(row.amount);}catch(error){throw new RowValidationError(row.id,'amount',`Строка ${index+1}: ${error instanceof Error?error.message:'Проверьте сумму.'}`);}
    }
    return {id:row.id,field:row.field,entity,currency:'RUB',period,state:row.state,value};
  });
  if(!Object.keys(product_map).length&&!entries.some(e=>e.field==='unit_cost'&&e.entity==='all-products'))throw new Error('Задайте общую себестоимость или добавьте отдельный товар. Неизвестное значение не заменяется нулём.');
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const a=entries[i],b=entries[j];
    if(a.field===b.field&&a.entity===b.entity){
      if(a.field==='unit_cost')throw new RowValidationError(rows[j].id,'amount',`Строки ${i+1} и ${j+1}: оставьте одну текущую себестоимость для этого товара или магазина.`);
      if(a.period&&b.period&&a.period.from<=b.period.to&&b.period.from<=a.period.to)throw new RowValidationError(rows[j].id,'from',`Строки ${i+1} и ${j+1}: периоды одного вида расходов пересекаются.`);
    }
  }
  const facts={product_map,entries};if(new TextEncoder().encode(JSON.stringify(facts)).length>20000)throw new Error('Слишком большой набор параметров. Сократите число строк.');return facts;
}
export function fromFacts(facts:Facts|null,store:string):Row[]{
  if(!facts)return [];
  if(!Array.isArray(facts.entries))throw new Error('Не удалось прочитать сохранённую версию. Не перезаписывайте её.');
  const mapped=Object.keys(facts.product_map);
  if(mapped.some(sku=>!facts.entries.some(e=>e.field==='unit_cost'&&e.entity===facts.product_map[sku])))throw new Error('Сохранённое сопоставление содержит товары без строк себестоимости. Сохранение отключено, чтобы не потерять эти связи.');
  const costs=new Map<string,Entry>();const selected:Entry[]=[];
  for(const entry of facts.entries){
    if(entry.field!=='unit_cost'){selected.push(entry);continue;}
    const prior=costs.get(entry.entity);
    if(!prior){const copy={...entry};costs.set(entry.entity,copy);selected.push(copy);}
    else if(prior.state!==entry.state||prior.value!==entry.value){prior.state='NOT_PROVIDED';prior.value=null;}
  }
  return selected.map(e=>{
    if(!Object.hasOwn(labels,e.field)||e.currency!=='RUB')throw new Error('Версия содержит неподдерживаемые поля. Сохранение отключено, чтобы не потерять данные.');
    const common=e.field==='unit_cost'&&e.entity==='all-products';
    const sku=e.field==='unit_cost'&&!common?Object.keys(facts.product_map).find(k=>facts.product_map[k]===e.entity):'';
    if((e.field==='unit_cost'&&!common&&!sku)||(e.field!=='unit_cost'&&e.entity!=='store:'+store))throw new Error('Сопоставление товаров не поддерживается этой формой. Данные не изменены.');
    return {id:e.id,field:e.field,sku:sku||'',...(common?{scope:'all' as const}:{}),from:e.field==='unit_cost'?'':e.period?.from||'',to:e.field==='unit_cost'?'':e.period?.to||'',state:e.state,amount:e.value??''};
  });
}
export function pendingKey(scope:string,store:string){return 'alisa.owner.pending.v1:'+scope+':'+store;}
export function readPending(storage:Pick<Storage,'getItem'>,key:string):Pending|null{
  const text=storage.getItem(key);if(!text)return null;
  const p=JSON.parse(text) as Pending;
  if(Object.keys(p).sort().join(',')!=='action,deadline,id,revision,store'||!/^[-0-9a-f]{36}$/i.test(p.id)||!Number.isSafeInteger(p.deadline)||!Number.isSafeInteger(p.revision)||!['approve','revoke'].includes(p.action))throw new Error('Не удалось прочитать ожидающую команду. Новые изменения не отправлены.');
  return p;
}

export function hasLegacyCostDates(facts:Facts|null):boolean{return !!facts?.entries.some(e=>e.field==='unit_cost'&&e.period!==null);}
