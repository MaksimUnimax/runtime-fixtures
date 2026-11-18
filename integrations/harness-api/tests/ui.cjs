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
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
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
    let auth = false, creates = 0, sends = 0, polls = 0, finished = false;
    let requestId = null, loseSendResponse = false, terminalOverride = null, heldPoll = null, holdPoll = false;
    let multipleChats = false, holdHistoryA = false, holdHistoryB = false, heldHistoryA = null, heldHistoryB = null;
    const chat = {id:'chat-1',title:'Продажи за вчера',updated_at:'2026-11-18T07:00:00Z'};
    const chatB = {id:'chat-2',title:'Другой разговор',updated_at:'2026-11-18T06:00:00Z'};
    const userMessage = {id:'u-1',role:'user',text:'Продажи за вчера'};
    const answer = {id:'a-1',role:'assistant',text:'### Продажи за 17 ноября\n\n| Магазин | Сумма |\n| --- | --- |\n| Тестовый Ozon | 1250 ₽ |\n\n<script>window.injected=true</script>\n\n[Полный результат]('+base+'/harness/api/reports/11111111-1111-4111-8111-111111111111/'+'a'.repeat(64)+')\n\n[Посторонняя ссылка](https://example.org/data)',metadata:{source_label:'Учебные данные'}};
    await page.route('**/harness/api/**', async route => {
      const url = new URL(route.request().url()); const p = url.pathname.slice('/harness/api'.length);
      const fulfill = (body, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if (!auth) return fulfill({error:'AUTH_REQUIRED',login_url:'/harness/login'},401);
      if (p === '/me') return fulfill({authenticated:true,user:{id:'synthetic-user',name:'Тестовый аккаунт'},stores:[{id:'store-1',name:'Тестовый Ozon',marketplace:'Ozon'}],ready:true});
      if (p === '/chats' && route.request().method() === 'POST') { creates++; return fulfill({chat}); }
      if (p === '/chats') return fulfill({chats:creates?(multipleChats?[chat,chatB]:[chat]):[]});
      if (p === '/chats/chat-1') { if(holdHistoryA){heldHistoryA=()=>fulfill({chat,messages:[userMessage,answer]});return;}return fulfill({chat,messages:finished?[userMessage,answer]:[userMessage]}); }
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
    await page.locator('#auto-speech').uncheck();await page.locator('#prompt').fill(userMessage.text);
    await page.locator('#composer').evaluate(form => {form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,1);assert.equal(creates,1);assert.ok(requestId);assert.equal(await page.locator('.message.assistant').count(),1);checks.push('double submit executes once');
    assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('.message table').count(),1);assert.equal(await page.locator('.message-body script').count(),0);assert.equal(await page.locator('.message-body a').count(),1);assert.match(await page.locator('.message-body a').getAttribute('href'),/\/harness\/api\/reports\//);checks.push('safe structured answer and authorized report rendering');
    await page.reload();await page.locator('.message.assistant').waitFor({state:'visible'});assert.equal(sends,1);checks.push('history reload does not dispatch');
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'harness-mobile.png'),fullPage:true,animations:'disabled'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(await page.locator('#send').isVisible(),true);await page.locator('#menu').click();assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('open')),true);await page.locator('#sidebar-backdrop').click();checks.push('mobile layout and navigation');
    await page.setViewportSize({width:1440,height:1000});await page.locator('#new-chat').click();polls=0;finished=false;loseSendResponse=true;
    await page.locator('#prompt').fill('Продажи за вчера');await page.locator('#send').click();await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,2);checks.push('lost send receipt recovered by status only');
    terminalOverride='interrupted';loseSendResponse=false;await page.locator('#new-chat').click();await page.locator('#prompt').fill('Первый вопрос');await page.locator('#send').click();await page.locator('#notice').filter({hasText:'Исполнение прервалось'}).waitFor({state:'visible'});const interruptedSends=sends;
    terminalOverride=null;finished=false;polls=0;await page.locator('#prompt').fill('Другой вопрос');await page.locator('#send').click();await page.locator('.message.assistant').waitFor({state:'visible',timeout:15000});assert.equal(sends,interruptedSends+1);checks.push('terminal interrupted does not lock future questions');
    await page.locator('#auto-speech').check();await page.evaluate(()=>{window.__spoken=[];speechSynthesis.speak=utterance=>window.__spoken.push(utterance.text);});
    multipleChats=true;holdHistoryA=true;holdHistoryB=true;finished=false;polls=0;
    await page.locator('#prompt').fill('Вопрос перед переходом');await page.locator('#send').click();
    for(let i=0;i<100&&!heldHistoryA;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldHistoryA);
    await page.locator('#chat-list button').filter({hasText:chatB.title}).click();
    for(let i=0;i<30&&!heldHistoryB;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldHistoryB);
    await heldHistoryA();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>window.__spoken),[]);
    await heldHistoryB();holdHistoryA=false;holdHistoryB=false;multipleChats=false;
    await page.locator('#chat-title').filter({hasText:chatB.title}).waitFor();assert.equal(await page.locator('.message.assistant').count(),0);checks.push('late history cannot append or speak after conversation navigation');
    holdPoll=true;await page.locator('#new-chat').click();await page.locator('#prompt').fill('Запрос перед выходом');await page.locator('#send').click();await page.waitForFunction(()=>document.getElementById('busy').hidden===false);
    for(let i=0;i<30&&!heldPoll;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldPoll);
    await page.locator('#logout').click();await page.locator('#login-screen').waitFor({state:'visible'});await heldPoll();await page.waitForTimeout(100);assert.equal(await page.locator('.message').count(),0);assert.equal(await page.locator('#app').isVisible(),false);checks.push('logout rejects late completion and clears displayed data');
    assert.deepEqual(failures,[]);checks.push('no browser runtime exceptions');
    fs.writeFileSync(path.join(evidence,'ui-results.json'),JSON.stringify({level:'SYNTHETIC_BROWSER',checks,sends,creates,viewports:[1440,390]},null,2));console.log(JSON.stringify({ok:true,checks,sends,creates}));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
