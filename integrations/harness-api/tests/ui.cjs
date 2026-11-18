/* Browser integration tests use a synthetic account and synthetic API results. */
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../static');
const evidence = process.env.QA_DIRECTORY || path.resolve(__dirname, '../../qa');
fs.mkdirSync(evidence, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/harness/' ? 'index.html' : path.basename(pathname));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
  res.end(fs.readFileSync(file));
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const failures = []; page.on('pageerror', e => failures.push(e.message));
    let developer=false, pluginWrites=0, historyMeter=true;const accountPlugins={matrix:true,'dev-meter':true};const chatPlugins={};
    const catalog=(chatId)=>({scope:chatId?'chat':'account',chat_id:chatId,plugins:[{id:'plugin-manager',name:'Диспетчер плагинов',description:'Управление возможностями чата через команды.',version:'1.0.0',required:true,enabled:true,setting_source:'required'},...['matrix',...(developer?['dev-meter']:[])].map(id=>({id,name:id==='matrix'?'Матрица':'Расход запросов',description:id==='matrix'?'Ответы по шаблонам и данным подключённых магазинов.':'Токены и оценка рублей из квитанций API. Только для разработчиков.',version:'1.0.0',required:false,enabled:chatId&&chatPlugins[chatId]?.[id]!==undefined?chatPlugins[chatId][id]:accountPlugins[id],setting_source:chatId&&chatPlugins[chatId]?.[id]!==undefined?'chat':'account'}))]});
    const meter={tokens:{prompt:14814,completion:114,cache_hit:14592,cache_miss:222,total:14928},calls:{model:1,selector:1,final:0},rub:{estimated:'0.0119946',known:'0.0119946',complete:true,priced_attempts:1,unpriced_attempts:0},quotes:[{as_of:'2026-11-13',fx_as_of:'2026-11-18',period:'offpeak',rates:{rub_per_currency:'82.4529'}}]};
    let auth = false, creates = 0, sends = 0, polls = 0, finished = false;
    let requestId = null, loseSendResponse = false, terminalOverride = null, heldPoll = null, holdPoll = false;
    let multipleChats = false, holdHistoryA = false, holdHistoryB = false, heldHistoryA = null, heldHistoryB = null;
    const chat = {id:'chat-1',title:'Продажи за вчера',updated_at:'2026-11-18T07:00:00Z'};
    const chatB = {id:'chat-2',title:'Другой разговор',updated_at:'2026-11-18T06:00:00Z'};
    const userMessage = {id:'u-1',role:'user',text:'Продажи за вчера'};
    const answer = {id:'a-1',role:'assistant',text:'За 17 ноября продажи — 1 250 ₽.',presentation:{schema:'octoport-chat-presentation/v1',summary:'За 17 ноября продажи — 1 250 ₽.',details:'### Продажи за 17 ноября\n\n| Магазин | Сумма |\n| --- | --- |\n| Тестовый Ozon | 1250 ₽ |\n\n<script>window.injected=true</script>\n\n[Полный результат]('+base+'/harness/api/reports/11111111-1111-4111-8111-111111111111/'+'a'.repeat(64)+')\n\n[Посторонняя ссылка](https://example.org/data)',report_urls:[]},metadata:{source_label:'Учебные данные',meter}};
    await page.route('**/harness/api/**', async route => {
      const url = new URL(route.request().url()); const p = url.pathname.slice('/harness/api'.length);
      const fulfill = (body, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if (!auth) return fulfill({error:'AUTH_REQUIRED',login_url:'/harness/login'},401);
      if (p === '/me') return fulfill({authenticated:true,user:{id:'synthetic-user',name:'Тестовый аккаунт',tenant_id:'synthetic-tenant'},permissions:{developer_meter:developer},stores:[{id:'store-1',name:'Тестовый Ozon',marketplace:'Ozon'}],ready:true});
      const pluginRoute=p.match(/^\/(?:chats\/([^/]+)\/)?plugins(?:\/([^/]+))?$/);
      if(pluginRoute){const [,chatId,pluginId]=pluginRoute;if(route.request().method()==='POST'){pluginWrites++;const value=route.request().postDataJSON().enabled;if(chatId){chatPlugins[chatId]??={};chatPlugins[chatId][pluginId]=value;}else accountPlugins[pluginId]=value;}return fulfill(catalog(chatId));}
      if(p==='/developer/meter')return developer&&accountPlugins['dev-meter']?fulfill({requests:[{job_id:'request-one',chat_id:chat.id,state:'completed',meter},{job_id:'request-two',chat_id:chat.id,state:'failed',meter:{...meter,tokens:{...meter.tokens,total:null},rub:{estimated:null,known:'0.002',complete:false,priced_attempts:1,unpriced_attempts:1}}}]}):fulfill({error:'PLUGIN_DISABLED'},403);
      if (p === '/chats' && route.request().method() === 'POST') { creates++; return fulfill({chat}); }
      if (p === '/chats') return fulfill({chats:creates?(multipleChats?[chat,chatB]:[chat]):[]});
      if (p === '/chats/chat-1') { if(holdHistoryA){heldHistoryA=()=>fulfill({chat,messages:[userMessage,historyMeter?answer:{...answer,metadata:{}}]});return;}return fulfill({chat,messages:finished?[userMessage,historyMeter?answer:{...answer,metadata:{}}]:[userMessage]}); }
      if (p === '/chats/chat-2') { if(holdHistoryB){heldHistoryB=()=>fulfill({chat:chatB,messages:[]});return;}return fulfill({chat:chatB,messages:[]}); }
      if (p === '/chats/chat-1/messages') { sends++; requestId=route.request().postDataJSON().request_id; if(loseSendResponse) return route.abort('connectionfailed'); return fulfill({request_id:requestId,status:'pending'},202); }
      if (p.startsWith('/requests/')) { polls++; if(holdPoll){heldPoll=()=>fulfill({request_id:requestId,status:'completed',message:answer});return;}if(terminalOverride)return fulfill({request_id:requestId,status:terminalOverride});if(polls===1&&!finished)return fulfill({request_id:requestId,status:'running'});finished=true;return fulfill({request_id:requestId,status:'completed',message:answer}); }
      if (p === '/logout') { auth=false; return fulfill({ok:true}); }
      return fulfill({error:'NOT_FOUND'},404);
    });
    await page.goto(base+'/harness/');await page.locator('#login-screen').waitFor({state:'visible'});
    assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#login-link').getAttribute('href'),'/harness/login');checks.push('anonymous login boundary');
    auth=true;await page.reload();await page.locator('#app').waitFor({state:'visible'});
    await page.screenshot({path:path.join(evidence,'harness-desktop.png'),fullPage:true});
    assert.equal(await page.locator('#auto-speech,#dictate').count(),0);assert.equal(await page.locator('#meter-link').isVisible(),false);checks.push('native reference geometry without voice controls');
    await page.locator('#prompt').fill(userMessage.text);
    await page.locator('#composer').evaluate(form => {form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,1);assert.equal(creates,1);assert.ok(requestId);assert.equal(await page.locator('.message.assistant').count(),1);checks.push('double submit executes once');
    assert.equal(await page.locator('.response-details').getAttribute('open'),null);assert.equal(await page.locator('.message.assistant > .message-body').innerText(),answer.text);await page.locator('.response-details > summary').click();
    assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('.message table').count(),1);assert.equal(await page.locator('.message-body script').count(),0);assert.equal(await page.locator('.message-body a').count(),1);assert.match(await page.locator('.message-body a').getAttribute('href'),/\/harness\/api\/reports\//);checks.push('concise answer with optional details and safe authorized report rendering');assert.equal(await page.locator('.message .meter-details').count(),0);checks.push('ordinary UI never displays developer billing');
    await page.reload();await page.locator('.message.assistant').waitFor({state:'visible'});assert.equal(sends,1);checks.push('history reload does not dispatch');
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'harness-mobile.png'),fullPage:true,animations:'disabled'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(await page.locator('#send').isVisible(),true);await page.locator('#menu').click();assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('open')),true);await page.locator('#sidebar-backdrop').click();checks.push('mobile layout and navigation');
    await page.setViewportSize({width:1440,height:1000});await page.locator('#new-chat').click();polls=0;finished=false;loseSendResponse=true;
    await page.locator('#prompt').fill('Продажи за вчера');await page.locator('#send').click();await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,2);checks.push('lost send receipt recovered by status only');
    terminalOverride='interrupted';loseSendResponse=false;await page.locator('#new-chat').click();await page.locator('#prompt').fill('Первый вопрос');await page.locator('#send').click();await page.locator('#notice').filter({hasText:'Исполнение прервалось'}).waitFor({state:'visible'});const interruptedSends=sends;
    terminalOverride=null;finished=false;polls=0;await page.locator('#prompt').fill('Другой вопрос');await page.locator('#send').click();await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,interruptedSends+1);checks.push('terminal interrupted does not lock future questions');
    multipleChats=true;holdHistoryA=true;holdHistoryB=true;finished=false;polls=0;
    await page.locator('#prompt').fill('Вопрос перед переходом');await page.locator('#send').click();
    for(let i=0;i<100&&!heldHistoryA;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldHistoryA);
    await page.locator('#chat-list button').filter({hasText:chatB.title}).click();
    for(let i=0;i<30&&!heldHistoryB;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldHistoryB);
    await heldHistoryA();await page.waitForTimeout(100);
    await heldHistoryB();holdHistoryA=false;holdHistoryB=false;multipleChats=false;
    await page.locator('#chat-title').filter({hasText:chatB.title}).waitFor();assert.equal(await page.locator('.message.assistant').count(),0);checks.push('late history cannot append after conversation navigation');
    developer=true;finished=true;await page.reload();await page.locator('#app').waitFor({state:'visible'});await page.locator('#chat-list button').filter({hasText:chat.title}).click();historyMeter=false;finished=false;polls=0;await page.locator('#prompt').fill('Проверка квитанции');await page.locator('#send').click();await page.locator('.message .meter-details').waitFor({state:'visible'});assert.equal(await page.locator('.message.assistant').count(),1);historyMeter=true;await page.reload();await page.locator('.message .meter-details').waitFor({state:'visible'});
    assert.match(await page.locator('.message .meter-details>summary').innerText(),/14\s?928/);await page.locator('.message .meter-details>summary').click();assert.match(await page.locator('.message .meter-details').innerText(),/82.4529/);await page.screenshot({path:path.join(evidence,'harness-developer-chat.png'),fullPage:true});checks.push('developer per-request meter preserves token receipt and dated FX');
    await page.locator('#plugins-link').click();await page.locator('[data-plugin-id="matrix"] input').waitFor();assert.equal(await page.locator('[data-plugin-id="plugin-manager"] input').isDisabled(),true);await page.locator('[data-plugin-id="matrix"] input').uncheck();await page.locator('#plugin-status').filter({hasText:'Сохранено'}).waitFor();assert.equal(accountPlugins.matrix,false);
    await page.locator('#scope-chat').click();await page.locator('[data-plugin-id="matrix"] input').waitFor();await page.locator('[data-plugin-id="matrix"] input').check();await page.locator('#plugin-status').filter({hasText:'Сохранено'}).waitFor();assert.equal(chatPlugins[chat.id].matrix,true);assert.equal(accountPlugins.matrix,false);await page.screenshot({path:path.join(evidence,'harness-plugins.png'),fullPage:true});checks.push('plugin account default and chat override are separate; manager pinned');
    await page.locator('#scope-account').click();await page.locator('[data-plugin-id="dev-meter"] input').waitFor();await page.locator('[data-plugin-id="dev-meter"] input').uncheck();await page.locator('#plugin-status').filter({hasText:'Сохранено'}).waitFor();await page.locator('#plugins-view .back-chat').click();assert.equal(await page.locator('.message .meter-details').count(),0);
    await page.locator('#plugins-link').click();await page.locator('[data-plugin-id="dev-meter"] input').check();await page.locator('#plugin-status').filter({hasText:'Сохранено'}).waitFor();await page.locator('#meter-link').click();await page.locator('.meter-card').first().waitFor();assert.equal(await page.locator('.meter-card').count(),2);assert.match(await page.locator('.meter-card').last().innerText(),/Стоимость не определена/);await page.screenshot({path:path.join(evidence,'harness-meter.png'),fullPage:true});checks.push('disabled meter hides receipts; failed unknown expense never shows zero');
    await page.locator('#theme-toggle').click();assert.equal(await page.locator('body').getAttribute('data-ds-dark-theme'),'');await page.screenshot({path:path.join(evidence,'harness-dark.png'),fullPage:true});await page.locator('#theme-toggle').click();await page.locator('#meter-view .back-chat').click();
    holdPoll=true;await page.locator('#new-chat').click();await page.locator('#prompt').fill('Запрос перед выходом');await page.locator('#send').click();await page.waitForFunction(()=>document.getElementById('busy').hidden===false);
    for(let i=0;i<30&&!heldPoll;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldPoll);
    await page.locator('#logout').click();await page.locator('#login-screen').waitFor({state:'visible'});await heldPoll();await page.waitForTimeout(100);assert.equal(await page.locator('.message').count(),0);assert.equal(await page.locator('#app').isVisible(),false);checks.push('logout rejects late completion and clears displayed data');
    assert.deepEqual(failures,[]);checks.push('no browser runtime exceptions');
    fs.writeFileSync(path.join(evidence,'ui-results.json'),JSON.stringify({level:'SYNTHETIC_BROWSER',checks,sends,creates,pluginWrites,viewports:[1440,390]},null,2));console.log(JSON.stringify({ok:true,checks,sends,creates}));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
