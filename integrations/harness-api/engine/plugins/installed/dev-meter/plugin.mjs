function localMeter(requestId){
  return{schema:'octoport-request-meter/v1',request_id:requestId,calls:{model:0,selector:0,final:0},
    tokens:{prompt:0,completion:0,cache_hit:0,cache_miss:0,total:0},
    rub:{estimated:'0',known:'0',complete:true,currency:'RUB',basis:'local_command_no_model_call',priced_attempts:0,unpriced_attempts:0},quotes:[],attempts:[]};
}

function meterFor(result,requestId){
  const meter=result?.metadata?.meter;
  if(meter?.schema==='octoport-request-meter/v1'&&meter.request_id===requestId)return structuredClone(meter);
  return result?.metadata?.local_only===true?localMeter(requestId):null;
}

function sumDecimals(values){
  let units=0n,scale=0;
  for(const value of values){
    const match=String(value).match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if(!match)return null;
    let digits=BigInt(match[1]+(match[2]??'')),places=(match[2]?.length??0)-Number(match[3]??0);
    if(Math.abs(places)>40)return null;
    if(places<0){digits*=10n**BigInt(-places);places=0;}
    if(places>scale){units*=10n**BigInt(places-scale);scale=places;}
    units+=digits*10n**BigInt(scale-places);
  }
  const raw=units.toString().padStart(scale+1,'0');
  return scale?(raw.slice(0,-scale)+'.'+raw.slice(-scale)).replace(/\.?0+$/,''):raw;
}

function summarize(requests){
  const meters=requests.map(row=>row.meter);
  const sum=(group,key)=>meters.every(m=>Number.isSafeInteger(m?.[group]?.[key]))?meters.reduce((n,m)=>n+m[group][key],0):null;
  const known=sumDecimals(meters.map(m=>m?.rub?.known??'0'));
  const complete=known!==null&&meters.every(m=>m?.rub?.complete===true&&m.rub.currency==='RUB');
  return{requests:requests.length,calls:{model:sum('calls','model'),selector:sum('calls','selector'),final:sum('calls','final')},
    tokens:Object.fromEntries(['prompt','completion','cache_hit','cache_miss','total'].map(key=>[key,sum('tokens',key)])),
    rub:{currency:'RUB',known,estimated:complete?known:null,complete,missing_receipts:meters.filter(m=>!m).length}};
}

function format(requests,summary){
  if(!requests.length)return'Завершённых запросов в этой области пока нет.';
  const latest=requests[0],meter=latest.meter;
  const lines=[`Расход последнего запроса ${latest.job_id}:`];
  if(!meter)lines.push('Провайдер не вернул подтверждённую квитанцию расхода; стоимость неизвестна.');
  else{
    lines.push(`Токены: вход ${meter.tokens?.prompt??'неизвестно'}, кэш ${meter.tokens?.cache_hit??'неизвестно'}, выход ${meter.tokens?.completion??'неизвестно'}.`);
    lines.push(meter.rub.complete?`Оценка стоимости: ${meter.rub.estimated} ₽.`:`Подтверждённая часть оценки: ${meter.rub.known} ₽; полная стоимость неизвестна.`);
  }
  if(requests.length>1)lines.push(`По ${summary.requests} запросам: ${summary.rub.complete?summary.rub.estimated+' ₽':(summary.rub.known??'0')+' ₽ известных частей; есть неполные квитанции'}.`);
  lines.push('Оценка рассчитана по тарифу и курсу, сохранённым при отправке; это не счёт провайдера.');
  return lines.join('\n');
}

export default{
  name:'octoport-dev-meter',
  inject:['octoportPlugins'],
  apply(ctx,{manifest,PipelineError}){
    ctx.octoportPlugins.register(ctx,manifest,{
      actions:{
        async requests({scope,args,readJobs}){
          if(Object.keys(args).some(key=>!['job_id','limit'].includes(key))||(args.job_id!==undefined&&(typeof args.job_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(args.job_id)))||(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)))throw new PipelineError('INVALID_PLUGIN_ARGUMENTS','Укажите job_id или limit от 1 до 100.');
          const jobs=readJobs().filter(job=>job.finished&&(!args.job_id||job.job_id===args.job_id)).sort((a,b)=>b.finished_at-a.finished_at).slice(0,args.limit??50);
          if(args.job_id&&!jobs.length)throw new PipelineError('JOB_NOT_FOUND','Запрос не найден.',404);
          const requests=jobs.map(job=>({job_id:job.job_id,chat_id:job.chat_id,state:job.state,meter:meterFor(job.result,job.job_id)}));
          const summary=summarize(requests);
          return{text:format(requests,summary),usage:{prompt_tokens:0,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:0},metadata:{local_only:true},data:{scope:scope.session_id?'chat':'account',requests,summary}};
        },
      },
      project({scope,result,projected}){
        projected.usage=result.usage??null;
        const {meter:ignored,...debug}=result.metadata??{};
        projected.metadata={...debug,...projected.metadata};
        const meter=meterFor(result,scope.request_id);
        if(meter)projected.metadata.meter=meter;
      },
    });
  },
};
