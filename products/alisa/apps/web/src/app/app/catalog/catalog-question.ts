export type CatalogPeriodChoice='yesterday'|'last7'|'custom';
export type CatalogDates={from:string;to:string};
type QuestionItem={description:string;kind:string;input_policy:{snapshot:boolean;time_axis:string;period_required:boolean}};

export function moscowCalendarDate(now:Date=new Date()):string{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(name:string)=>parts.find(value=>value.type===name)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
}
function validDate(value:string):boolean{
  if(!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))return false;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function shiftDate(value:string,days:number):string{
  return new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
}
export function catalogPeriodError(choice:CatalogPeriodChoice,dates:CatalogDates,today:string):string|null{
  if(!validDate(today))return 'Обновите страницу, чтобы выбрать период.';
  if(choice==='yesterday'||choice==='last7')return null;
  if(choice!=='custom'||!validDate(dates.from)||!validDate(dates.to))return 'Укажите обе даты периода.';
  if(dates.from>dates.to)return 'Дата начала должна быть не позже даты окончания.';
  if(dates.to>today)return 'Дата окончания должна быть не позже сегодняшней даты.';
  return null;
}
function displayDate(value:string):string{return value.split('-').reverse().join('.');}
export function catalogQuestion(item:QuestionItem,choice:CatalogPeriodChoice,dates:CatalogDates,today:string):string|null{
  let suffix='';
  if(item.kind==='parameter'){
    // A report's period must not replace a coefficient's independently confirmed period.
  }else if(item.input_policy.snapshot){
    suffix=' сейчас';
  }else if(item.input_policy.time_axis!=='none'&&item.input_policy.period_required){
    if(catalogPeriodError(choice,dates,today))return null;
    if(choice==='yesterday')suffix=' за вчера';
    else{
      const range=choice==='last7'?{from:shiftDate(today,-7),to:shiftDate(today,-1)}:dates;
      suffix=' с '+displayDate(range.from)+' по '+displayDate(range.to);
    }
  }
  // Keep the selected dates intact even when a published description is long.
  return 'Покажи '+item.description.split('. ')[0].slice(0,1200-'Покажи '.length-suffix.length)+suffix;
}
