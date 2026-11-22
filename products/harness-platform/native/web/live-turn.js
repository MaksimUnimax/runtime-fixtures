// Progress reads have no dispatch or billing side effects. Only the original POST sends the turn.
export class LiveTurns {
  views = new Map();
  listeners = new Map();

  subscribe(id, listener) {
    const set=this.listeners.get(id) || new Set();
    this.listeners.set(id,set);
    set.add(listener);
    return ()=>{set.delete(listener);if(!set.size)this.listeners.delete(id);};
  }
  update(id, view) {
    if(view)this.views.set(id,view);else this.views.delete(id);
    for(const listener of this.listeners.get(id)||[])listener();
  }
  clear(id,rid) {
    if(this.views.get(id)?.rid===rid)this.update(id,null);
  }
  async watch(id,rid,signal,accepted) {
    const url='/api/chats/'+encodeURIComponent(id)+'/progress?requestId='+encodeURIComponent(rid);
    while(!signal.aborted && this.views.get(id)?.rid===rid){
      try {
        const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
        if(!response.ok || !response.body)return;
        const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
        let tail='';
        try {
          while(!signal.aborted){
            const {value,done}=await reader.read();
            if(done)break;
            const lines=(tail+value).split('\n');
            tail=lines.pop();
            for(const line of lines){
              if(!line)continue;
              const state=JSON.parse(line);
              const current=this.views.get(id);
              if(!current || current.rid!==rid || current.committed)return;
              if(state.stage!=='waiting'){
                this.update(id,{...current,stage:state.stage,text:state.text,notices:state.notices});
                accepted?.();
              }
              if(state.done)return;
            }
          }
        } finally {reader.releaseLock();}
      } catch {if(signal.aborted)return;}
      if(!signal.aborted)await new Promise(resolve=>setTimeout(resolve,300));
    }
  }
}
