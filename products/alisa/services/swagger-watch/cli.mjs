import {resolve} from 'node:path';
import {serveStatus} from './status.mjs';
import {readBounded,loadState,publicStatus,runWatch,importCandidate,acceptReviewed} from './watch.mjs';
const [command,...args]=process.argv.slice(2),root='/var/lib/alisa-swagger-watch';
try{
  if(['run','import','accept-reviewed'].includes(command)&&process.env.ALISA_SWAGGER_MUTATION_LOCKED!=='1')throw Error('NATIVE_LOCK_REQUIRED');
  let result;
  if(command==='run'&&args.length===0)result=await runWatch(root);
  else if(command==='serve'&&args.length===0){serveStatus(root);result={status:'STARTED',scope:'READ_ONLY_PUBLIC_DOCUMENT_STATUS'};}
  else if(command==='status'&&args.length===0)result=publicStatus(await loadState(root));
  else if(command==='import'&&args.length===2)result=await importCandidate(root,args[0],await readBounded(resolve(args[1])));
  else if(command==='accept-reviewed'&&args.length===2)result=await acceptReviewed(root,args[0],args[1]);
  else throw Error('INVALID_COMMAND');
  console.log(JSON.stringify(result));
}catch{console.error('ALISA_SWAGGER_WATCH_FAILED');process.exitCode=1;}
