import assert from 'node:assert/strict';
import test from 'node:test';
import {privatePrompt, isPrivatePaste} from './web/private-input.js';

test('connection questions and free-form marketplace requests reach the chat',async()=>{
  for (const text of [
    'Как мне добавить ещё один магазин Wildberries?',
    'Мне нужно понять, как подключить магазин Ozon',
    'Добавь продажи WB в отчёт', 'Сохрани отчёт по магазину',
    'Настроить магазин или сначала дать доступ?',
    'Объясни, как получить ключ к магазину',
  ]) assert.equal(await privatePrompt(text,false,null,'chat'),false,text);
});

test('explicit form commands and private credentials stay on the private path',async t=>{
  const events=[];
  const old=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:e=>events.push(e)}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;});
  const calls=[];
  const api=async(...args)=>calls.push(args);
  for(const text of ['Добавь магазин WB','Подключить Ozon','Пожалуйста, настрой интеграцию','Подключите новый магазин Wildberries!']){
    assert.equal(await privatePrompt(text,false,api,'chat'),true);
  }
  assert.equal(calls.length,0);
  assert.equal(events.length,4);
  const input='Как подключить магазин WB? токен: fixture-only-value';
  assert.equal(isPrivatePaste(input),true);
  assert.equal(await privatePrompt(input,false,api,'chat'),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/integrations');
});
