const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/alice_lab.py', 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];

async function scenario(mode) {
  let listener, resolveFetch, requests = [], submissions = 0;
  const nonce = {value: 'expired-synthetic-nonce'};
  const button = {disabled: false};
  const status = {textContent: ''};
  const form = {
    querySelector(selector) { assert.equal(selector, 'button[type="submit"]'); return button; },
    elements: {namedItem(name) { assert.equal(name, 'nonce'); return nonce; }},
    addEventListener(name, handler) { assert.equal(name, 'submit'); listener = handler; }
  };
  Object.defineProperty(form, 'password', {get() { throw Error('credential read'); }});
  const context = {
    document: {querySelector: () => form, getElementById: () => status},
    window: {location: {href: 'https://lab.example/oauth/authorize?state=synthetic&scope=reports%3Aread'}},
    fetch: (url, options) => {
      requests.push({url, options});
      return new Promise(resolve => {resolveFetch = resolve;});
    },
    DOMParser: class {
      parseFromString(text, kind) {
        assert.equal(kind, 'text/html');
        return {querySelector: selector => {
          assert.equal(selector, 'form[action="/oauth/authorize"] input[name="nonce"]');
          return mode === 'missing' ? null : {value: 'fresh-synthetic-nonce'};
        }};
      }
    },
    HTMLFormElement: {prototype: {submit() {
      assert.equal(this, form);
      assert.equal(nonce.value, 'fresh-synthetic-nonce');
      submissions++;
    }}}
  };
  vm.runInNewContext(script, context);
  let prevented = 0;
  const event = {preventDefault() {prevented++;}};
  const work = listener(event);
  assert.equal(button.disabled, true);
  await listener(event); // A second click cannot issue another GET or POST.
  assert.equal(requests.length, 1);
  assert.equal(prevented, 2);
  resolveFetch({ok: mode !== 'http-failure', text: async () => '<form>synthetic</form>'});
  await work;
  const request = requests[0];
  assert.equal(request.url, context.window.location.href);
  assert.equal(JSON.stringify(request.options), JSON.stringify({
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error'
  }));
  assert.equal('body' in request.options, false);
  assert.equal(submissions, mode === 'success' ? 1 : 0);
  if (mode !== 'success') {
    assert.equal(nonce.value, 'expired-synthetic-nonce');
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /Не удалось/);
  }
}
(async () => {
  for (const mode of ['success', 'http-failure', 'missing']) await scenario(mode);
  console.log('3 form renewal scenarios passed (synthetic values, no network)');
})().catch(error => { console.error(error); process.exitCode = 1; });
