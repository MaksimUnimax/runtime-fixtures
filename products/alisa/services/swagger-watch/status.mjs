import {createServer} from 'node:http';
import {loadState,publicStatus} from './watch.mjs';
export function serveStatus(root,{port=18104,host='127.0.0.1'}={}){
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.url!=='/health/swagger'||!['GET','HEAD'].includes(req.method)||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0){res.writeHead(404);res.end('{"code":"NOT_FOUND"}');return;}
    try{
      const result=publicStatus(await loadState(root));res.writeHead(result.status==='READY'?200:503);
      res.end(req.method==='HEAD'?'':JSON.stringify(result));
    }catch{res.writeHead(503);res.end('{"status":"UNAVAILABLE","scope":"PUBLIC_OPENAPI_DOCUMENTS_ONLY"}');}
  });
  server.requestTimeout=3000;server.headersTimeout=3000;server.keepAliveTimeout=1000;server.maxConnections=32;
  server.listen(port,host);return server;
}
