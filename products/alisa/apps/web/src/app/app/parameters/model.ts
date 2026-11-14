/** Exact decimal editing. No old coefficient numbers in browser persistence. */
export type Area={kind:'store'|'sku';sku:string};
export type Period={from:string;to:string};
export type ParameterValue={parameter:string;scope:Area;state:'VALUE'|'INHERIT';revision:number;value:string|null;unit:string;origin:'manual'|'calculated'|'';collected_at:string|null;calculated_at:string|null;updated_at:string;requested_period:Period|null;actual_period:Period|null;evidence:Record<string,unknown>};
export type Current={store_id:string;parameter:string;scope:Area;revision:number;state:string;current:ParameterValue|null;effective:ParameterValue|null;inherited:boolean;server_time:number};
export type Definition={key:string;label:string;unit:string;minimum:string;maximum:string|null;scopes:('store'|'sku')[];producer_template:string;collection:{available:boolean;code:string}};
export type Product={sku:string;name:string;offer_id:string;parameter_reference?:string};
export type Store={id:string;name:string;provider:string;status:string;identity_verified?:boolean};
export type Pending={id:string;store:string;parameter:string;scope:Area;revision:number;not_after:number;action:'set_manual'|'use_general'};
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decimal(value:string):string{
 const n=value.trim().replace(',','.');
 if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(n)||n.replace('.','').length>60)throw Error('Введите неотрицательное число без пробелов, процентов и экспоненты.');
 return n.includes('.')?n.replace(/0+$/,'').replace(/\.$/,''):n;
}
function shift(value:string,places:number):string{
 const n=decimal(value),[whole,fraction='']=n.split('.');
 const digits=(whole+fraction).replace(/^0+(?=\d)/,'');
 const scale=fraction.length-places;
 if(scale<=0)return decimal((digits+'0'.repeat(-scale)).replace(/^0+(?=\d)/,''));
 const padded=digits.padStart(scale+1,'0');return decimal(padded.slice(0,-scale)+'.'+padded.slice(-scale));
}
export function enteredValue(value:string,unit:string):string{
 const n=decimal(value);
 if(unit==='ratio'){
  const [w,f='']=n.split('.');if(BigInt(w)>100n||(BigInt(w)===100n&&/[1-9]/.test(f)))throw Error('Процент должен быть от нуля до ста.');
  return shift(n,-2);
 }
 return n;
}
export function shownValue(value:string|null,unit:string):string{
 if(value===null)return 'Не задано';
 return (unit==='ratio'?shift(value,2):decimal(value)).replace('.',',');
}
export function unitLabel(unit:string){return unit==='ratio'?'%':unit==='RUB/ordered_unit'?'₽ на заказанную единицу':unit;}
export function dateText(value:string|null):string{
 if(!value)return 'Не выполнялся';const t=new Date(value);
 if(!Number.isFinite(t.getTime()))return 'Дата недоступна';
 return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(t)+' МСК';
}
export function periodRequest(choice:string,from:string,to:string):{months:number}|Period|null{
 if(choice==='12')return null; // Untouched default may use proven shorter history.
 if(['6','3'].includes(choice))return {months:Number(choice)};
 const valid=(v:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v&&Number(v.slice(0,4))>0;
 };
 if(choice!=='custom'||!valid(from)||!valid(to)||from>to)throw Error('Укажите корректные начало и конец периода.');
 return {from,to};
}
export function pendingKey(profile:string,store:string,parameter:string,area:Area){return 'alisa.parameter.pending.v1:'+JSON.stringify([profile,store,parameter,area.kind,area.sku]);}
export function readPending(storage:Pick<Storage,'getItem'>,key:string):Pending|null{
 const raw=storage.getItem(key);if(!raw)return null;const p=JSON.parse(raw)as Pending;
 if(!p||Object.keys(p).sort().join(',')!=='action,id,not_after,parameter,revision,scope,store'||!UUID.test(p.id)||!UUID.test(p.store)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isSafeInteger(p.not_after)||typeof p.parameter!=='string'||!p.scope||Object.keys(p.scope).sort().join(',')!=='kind,sku'||!['set_manual','use_general'].includes(p.action)||!(p.scope.kind==='store'&&p.scope.sku===''||p.scope.kind==='sku'&&/^[1-9]\d{0,19}$/.test(p.scope.sku)))throw Error('Не удалось прочитать состояние сохранения. Новая запись не отправлена.');
 return p;
}
export const errors:Record<string,string>={
 PARAMETER_REVISION_CONFLICT:'Значение уже изменено в другом запросе. Обновите данные перед новой записью.',
 PARAMETER_SKU_UNVERIFIED:'Подтверждение товара истекло. Обновите каталог и выберите товар заново.',
 OWNER_COMMAND_EXPIRED:'Время команды сохранения истекло. Проверьте текущее значение и повторите своё изменение.',
 PARAMETER_SOURCE_NOT_QUALIFIED:'Расчёт по данным магазина ещё не подключён. Число можно ввести вручную.',
 AUTHENTICATION_REQUIRED:'Сессия завершена. Войдите снова.',
 OWNER_SOURCE_AUTH_CHANGED:'Права изменились. Обновите страницу.',
 PARAMETER_RANGE:'Значение вне допустимого диапазона.',
 PARAMETER_PLATFORM:'Этот параметр пока не поддержан для выбранной площадки.',
 PARAMETER_UNFINISHED_DAY:'Расчётный период должен заканчиваться не позднее вчерашнего дня.',
 NOT_FOUND:'Раздел или выбранный магазин недоступен.',
};
export function errorText(value:unknown):string{return typeof value==='string'&&errors[value]?errors[value]:'Операция не завершена. Сохранённые значения не заменяются нулями.';}


export type CollectionPending={id:string;store:string;parameter:string;scope:Area;not_after:number};
export function readCollection(storage:Pick<Storage,'getItem'>,key:string):CollectionPending|null{
 const raw=storage.getItem(key);if(!raw)return null;const p=JSON.parse(raw)as CollectionPending;
 if(!p||Object.keys(p).sort().join(',')!=='id,not_after,parameter,scope,store'||!UUID.test(p.id)||!UUID.test(p.store)||typeof p.parameter!=='string'||!Number.isSafeInteger(p.not_after)||!p.scope||Object.keys(p.scope).sort().join(',')!=='kind,sku'||!(p.scope.kind==='store'&&p.scope.sku===''||p.scope.kind==='sku'&&/^[1-9]\d{0,19}$/.test(p.scope.sku)))throw Error('Не удалось прочитать состояние запуска. Новый сбор не отправлен.');
 return p;
}
Object.assign(errors,{
 PARAMETER_COLLECTION_NOT_ENABLED:'Сбор коэффициентов ещё не включён. Ручной ввод доступен.',
 PARAMETER_COLLECTION_UNAVAILABLE:'Исполнитель сбора сейчас недоступен. Текущее значение не изменено.',
 PARAMETER_SOURCE_SCOPE_UNAVAILABLE:'Этот источник пока не позволяет обоснованно рассчитать отдельный товар. Используйте общее значение или задайте число вручную.',
 PARAMETER_INTENT_EXPIRED:'Срок задания истёк или сбор отменён. Новое значение не записано.',
 UNKNOWN_OUTCOME:'Приём задания не подтверждён. Проверьте запуск, не создавая новый сбор.',
 PARAMETER_INTENT_MISMATCH:'Параметры задания не совпали с подтверждёнными. Изменение не выполнено.',
});
