// Credentials use the private connection endpoint before chat history or model dispatch.
const providers = {
  ozon:/(?:\bozon\b|озон)/i, wb:/(?:wildberries|вайлдберри|вб\b|(?:^|[\s,])вб(?=[\s,:]|$)|\bwb\b)/i,
  wordstat:/(?:wordstat|вордстат|яндекс\s*(?:директ|адвордс))/i
};
const aliases = {
  'client_id':'client_id','client-id':'client_id','api_key':'api_key','api-key':'api_key',
  'performance_id':'performance_id','performance_secret':'performance_secret','client_secret':'performance_secret',
  'token':'token','токен':'token','ключ':'token','oauth':'token','oauth_token':'token'
};
const hint=/(?:api[-_ ]?key|client[-_ ]?(?:id|secret)|performance_(?:id|secret)|oauth[-_ ]?(?:token|токен)|token|токен|ключ)["']?\s*[:=]|eyJ[\w-]{8,}\.[\w-]+\.[\w-]+|y0_[\w-]{12,}/i;
export function parsePrivate(text, selected='') {
  const provider=selected || Object.keys(providers).find(k=>providers[k].test(text)) || '';
  const values={};
  for(const match of text.matchAll(/(?:^|[\s,{])["']?(client[-_]id|api[-_]key|performance_(?:id|secret)|client_secret|oauth_token|oauth|токен|ключ|token)["']?\s*[:=]\s*["']?([^\s"',;}]+)/gi)) {
    const k=aliases[match[1].toLowerCase()];
    values[k==='token' && provider==='ozon'?'api_key':k]=match[2];
  }
  if(selected && selected!=='ozon' && !Object.keys(values).length && /^\S{5,8192}$/.test(text))values.token=text;
  const named=text.match(/(?:магазин|название|name)["']?\s*[:=]\s*["']?([^\n,;"'}]+)/i);
  return {provider,fields:values,name:named?.[1]?.trim()||''};
}
function complete({provider,fields:f}) {
  if(provider==='ozon')return !!((f.client_id&&f.api_key)||(f.performance_id&&f.performance_secret)) &&
    Boolean(f.client_id)===Boolean(f.api_key) && Boolean(f.performance_id)===Boolean(f.performance_secret);
  return !!provider && !!f.token;
}
export async function privatePrompt(text,guest,api,chatId) {
  const parsed=parsePrivate(text);
  if(!hint.test(text) && !(/(?:^|[\s,])(?:подключи(?:ть|те)?|добав(?:ь|ить|ьте)|сохрани(?:ть|те)?|настро(?:ить|й|йте))(?=[\s,!?.:]|$)/i.test(text)
     && (parsed.provider || /(?:ключ|токен|интеграц|магазин|маркет)/i.test(text))))return false;
  const emit=detail=>window.dispatchEvent(new CustomEvent('harness:connection',{detail:{...detail,chatId}}));
  if(guest){emit({notice:'Войдите в аккаунт, чтобы подключить сервис.'});return true;}
  if(!parsed.provider){emit({notice:'Доступны Ozon, Wildberries и Яндекс Вордстат. Выберите сервис в настройках интеграций.'});return true;}
  if(complete(parsed)){
    const name=parsed.name || ({ozon:'Ozon',wb:'Wildberries',wordstat:'Яндекс Вордстат'})[parsed.provider];
    try {
      await api('/api/integrations',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...parsed,name,chatId})});
      window.dispatchEvent(new Event('harness:grants'));
      emit({notice:'Ключи сохранены. Подключение прикреплено к этому чату.'});
    } catch {emit({...parsed,name,notice:'Сохранить ключи не удалось. Повторите в форме.'});}
  } else emit(parsed);
  return true;
}

export function protectPaste(guest,api) {
  document.addEventListener('paste',event=>{
    const element=event.target;
    if(!element.closest?.('[contenteditable=true],textarea') || element.closest('[data-private-connection],dialog'))return;
    const text=event.clipboardData?.getData('text/plain')||'';
    if(!hint.test(text))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const parsed=parsePrivate(text);
    window.dispatchEvent(new CustomEvent('harness:connection',{detail:guest
      ? {notice:'Войдите в аккаунт, чтобы подключить сервис.'}
      : parsed.provider ? {...parsed,chatId:location.pathname.match(/^\/app\/chats\/([^/]+)$/)?.[1]||window.harnessAccount?.selected} : {notice:'Откройте Настройки → Интеграции и укажите сервис перед вводом ключа.'}}));
  },true);
}
