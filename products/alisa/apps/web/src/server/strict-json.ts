/** Reject duplicate keys before JSON.parse can silently accept the last value. */
export function strictJson(text:string):unknown{
  let i=0;const white=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
  function string():string{
    if(text[i]!=='"')throw new Error('INVALID_JSON');const start=i++;
    while(i<text.length){const c=text[i++];if(c==='"')return JSON.parse(text.slice(start,i));if(c==='\\')i++;}
    throw new Error('INVALID_JSON');
  }
  function value(depth:number):void{
    if(depth>40)throw new Error('INVALID_JSON');white();
    if(text[i]==='{'){
      i++;white();const keys=new Set<string>();if(text[i]==='}'){i++;return;}
      while(true){white();const key=string();if(keys.has(key))throw new Error('DUPLICATE_KEY');keys.add(key);white();if(text[i++]!==':')throw new Error('INVALID_JSON');value(depth+1);white();const delimiter=text[i++];if(delimiter==='}')return;if(delimiter!==',')throw new Error('INVALID_JSON');}
    }
    if(text[i]==='['){i++;white();if(text[i]===']'){i++;return;}while(true){value(depth+1);white();const delimiter=text[i++];if(delimiter===']')return;if(delimiter!==',')throw new Error('INVALID_JSON');}}
    if(text[i]==='"'){string();return;}
    const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!token)throw new Error('INVALID_JSON');i+=token[0].length;
  }
  value(0);white();if(i!==text.length)throw new Error('INVALID_JSON');return JSON.parse(text);
}
