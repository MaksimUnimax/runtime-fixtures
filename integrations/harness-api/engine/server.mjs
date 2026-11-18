import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HarnessEngine } from './engine.mjs';
import { createPipelineClient } from './pipeline-client.mjs';
import { PipelineError } from './provider.mjs';

function secret(name, fallback) {
  const credential = process.env.CREDENTIALS_DIRECTORY && path.join(process.env.CREDENTIALS_DIRECTORY, name);
  const file = credential && fs.existsSync(credential) ? credential : fallback;
  const value = fs.readFileSync(file, 'utf8').trim();
  if (value.length < 32 || /[\r\n]/.test(value)) throw new Error(`Invalid credential file: ${name}`);
  return value;
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 100000) throw new PipelineError('PAYLOAD_TOO_LARGE', 'Слишком большой запрос.', 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch { throw new PipelineError('BAD_JSON', 'Некорректный JSON.'); }
}

export function createServer(engine, serviceKey) {
  const expected = Buffer.from(`Bearer ${serviceKey}`);
  const routes = {
    '/v1/chats/create': ['create',201], '/v1/chats/list':['list',200],
    '/v1/chats/history':['history',200], '/v1/chats/send':['send',202],
    '/v1/jobs/status':['status',200], '/v1/chats/cancel':['cancel',200],
  };
  return http.createServer(async (request,response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return json(response,200,engine.health());
      const given = Buffer.from(request.headers.authorization || '');
      if (given.length !== expected.length || !crypto.timingSafeEqual(given,expected)) return json(response,401,{code:'UNAUTHORIZED',error:'Требуется служебная авторизация.'});
      const route = routes[request.url];
      if (request.method !== 'POST' || !route) return json(response,404,{code:'NOT_FOUND',error:'Метод не найден.'});
      const result = await engine[route[0]](await body(request));
      json(response,route[1],result);
    } catch (error) {
      json(response,error instanceof PipelineError ? error.status : 500,{code:error instanceof PipelineError ? error.code : 'ENGINE_ERROR',error:error instanceof PipelineError ? error.message : 'Ошибка обработки запроса.'});
    }
  });
}

async function main() {
  process.umask(0o077);
  const serviceKey = secret('bridge.key',process.env.OCTOPORT_BRIDGE_KEY_FILE || '/etc/octoport-harness/bridge.key');
  const deepseekKey = secret('deepseek.key',process.env.DEEPSEEK_KEY_FILE || '/var/lib/alice-lab/secrets/deepseek.key');
  const stateDirectory = process.env.OCTOPORT_ENGINE_STATE || '/var/lib/octoport-harness/engine';
  const execute = createPipelineClient({ url:process.env.OCTOPORT_PIPELINE_URL || 'http://127.0.0.1:18131/internal/harness/query', serviceKey });
  const engine = await new HarnessEngine({stateDirectory,execute,deepseekKey}).start();
  const server = createServer(engine,serviceKey);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const port = Number(process.env.OCTOPORT_ENGINE_PORT || 18132);
  server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'harness_engine_ready',port,harness_version:engine.runtime.version})));
  let closing = false;
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{
    if (closing) return;
    closing=true;
    server.close();
    try { await engine.close();process.exit(0); }
    catch { console.error('harness_engine_shutdown_failed');process.exit(1); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch(()=>{console.error('harness_engine_start_failed');process.exitCode=1;});
