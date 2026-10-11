/* Data-only prompt trees. No provider API, Send, DOM profiles or access grants. */
(() => {
  "use strict";
  const FORMAT = "octoport_prompt_tree_v1", KEY = "octoport_prompt_trees_v1";
  const id = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
  const failure = code => Object.assign(new Error(code),{code});
  function validateBody(body) {
    if (!exact(body,["format","root","nodes"]) || body.format !== FORMAT || !Array.isArray(body.nodes) || body.nodes.length > 128 ||
      new TextEncoder().encode(JSON.stringify(body)).length > 65536 || (body.root !== null && !id(body.root))) return false;
    const nodes = new Map();
    for (const node of body.nodes) {
      if (!exact(node,["id","text","children"]) || !id(node.id) || nodes.has(node.id) || typeof node.text !== "string" ||
        node.text.length > 8192 || !Array.isArray(node.children) || node.children.length > 64 || !node.children.every(id)) return false;
      nodes.set(node.id,node);
    }
    if (body.root === null) return body.nodes.length === 0;
    const seen = new Set();
    const visit = key => {
      if (seen.has(key) || !nodes.has(key)) return false;
      seen.add(key);return nodes.get(key).children.every(visit);
    };
    return visit(body.root) && seen.size === nodes.size;
  }
  function canonicalBody(body) {
    if (!validateBody(body)) throw failure("AI_TREE_INVALID_BODY");
    return JSON.stringify({format:body.format,root:body.root,nodes:[...body.nodes]
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(n=>({id:n.id,text:n.text,children:[...n.children]}))});
  }
  async function digest(body) {
    const value = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalBody(body)));
    return [...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  function render(body) {
    if (!validateBody(body) || !body.root) throw failure("AI_TREE_NOT_PUBLISHED");
    const byId = new Map(body.nodes.map(node=>[node.id,node]));
    const lines=[];
    const visit=(key,depth)=>{const n=byId.get(key);lines.push(`${"  ".repeat(depth)}${n.text}`);n.children.forEach(child=>visit(child,depth+1));};
    visit(body.root,0);return lines.join("\n\n");
  }
  function createCache({storage,verifier,trustBundle,authorize,fetchManifest,now=()=>Date.now(),intervalMs=6*60*60*1000}) {
    let state=null,loadFlight=null,writer=Promise.resolve(),storageFailed=false;
    const flights=new Map();
    const aliasKey=(ctx,detected)=>JSON.stringify([ctx.origin,ctx.accountId,detected.family,detected.surface,detected.variant??null]);
    const entryKey=(ctx,aiId)=>JSON.stringify([ctx.origin,ctx.accountId,aiId]);
    async function load() {
      if(state)return;
      if(!loadFlight)loadFlight=(async()=>{
        const saved=(await storage.get(KEY))[KEY];
        if(saved && (!exact(saved,["schema","entries","aliases"]) || saved.schema!==1 ||
          !saved.entries || !saved.aliases || Array.isArray(saved.entries) || Array.isArray(saved.aliases)))throw failure("AI_TREE_CACHE_CORRUPT");
        state=saved?clone(saved):{schema:1,entries:{},aliases:{}};
      })().finally(()=>{loadFlight=null;});
      await loadFlight;
    }
    async function stillCurrent(detected,ctx) {
      const current=await authorize(detected);
      if(!current || JSON.stringify(current)!==JSON.stringify(ctx))throw failure("AI_TREE_CONTEXT_CHANGED");
    }
    async function validateEntry(entry,ctx,detected) {
      if(!entry)return null;
      const verified=await verifier.verifyPromptTreeV1(entry.envelope,trustBundle);
      const claim=verified.payload,p=claim?.publication;
      if(!verified.ok || claim.accountId!==ctx.accountId || JSON.stringify(claim.detected)!==JSON.stringify(detected) ||
        !p?.body || claim.aiId!==entry.aiId || p.version!==entry.version || p.sha256!==entry.sha256 || entry.format!==p.format ||
        !validateBody(entry.body) || await digest(entry.body)!==p.sha256)throw failure("AI_TREE_CACHE_UNVERIFIED");
      return entry;
    }
    async function install(next,detected,ctx) {
      const run=async()=>{
        if(storageFailed)throw failure("AI_TREE_STORAGE_UNCONFIRMED");
        await stillCurrent(detected,ctx);
        const updated=clone(state),key=entryKey(ctx,next.aiId),old=updated.entries[key];
        if(old && (next.version<old.version || (next.version===old.version && next.sha256!==old.sha256)))throw failure("AI_TREE_VERSION_REGRESSION");
        updated.entries[key]=clone(next);updated.aliases[aliasKey(ctx,detected)]=next.aiId;
        if(new TextEncoder().encode(JSON.stringify(updated)).length>4*1024*1024)throw failure("AI_TREE_CACHE_LIMIT");
        try {
          await storage.set({[KEY]:updated});const readback=(await storage.get(KEY))[KEY];
          if(JSON.stringify(readback)!==JSON.stringify(updated))throw failure("AI_TREE_STORAGE_READBACK_FAILED");
        }catch(error){storageFailed=true;throw error;}
        // A response cannot become usable through a logout/deny while storage was pending.
        await stillCurrent(detected,ctx);state=updated;
      };
      const pending=writer.then(run,run);writer=pending.catch(()=>{});return pending;
    }
    async function get(input,options={}) {
      const detected={family:input.family,surface:input.surface,variant:input.variant??null};
      const ctx=await authorize(detected);if(!ctx)throw failure("AI_TREE_ACCESS_REQUIRED");
      await load();const aiId=state.aliases[aliasKey(ctx,detected)];
      const candidate=aiId?state.entries[entryKey(ctx,aiId)]:null;
      if(candidate && candidate.aiId!==aiId)throw failure("AI_TREE_CACHE_ID_MISMATCH");
      const saved=await validateEntry(candidate,ctx,detected);
      if(options.offline || (!options.refresh && saved && Number.isFinite(saved.checkedAt) && now()>=saved.checkedAt && now()-saved.checkedAt<intervalMs)) {
        if(!saved)throw failure("AI_TREE_CACHE_MISSING");await stillCurrent(detected,ctx);return clone(saved);
      }
      const key=JSON.stringify([ctx,detected]);
      if(flights.has(key))return clone(await flights.get(key));
      const pending=(async()=>{
        const requestNonce=crypto.randomUUID();
        const envelope=await fetchManifest({detected,context:ctx,requestNonce,
          known:saved?{aiId:saved.aiId,version:saved.version,sha256:saved.sha256}:null});
        const verified=await verifier.verifyPromptTreeV1(envelope,trustBundle),claim=verified.payload;
        if(!verified.ok)throw failure(`AI_TREE_${verified.error}`);
        if(claim.requestNonce!==requestNonce || claim.accountId!==ctx.accountId || claim.deviceId!==ctx.deviceId || claim.sessionId!==ctx.sessionId ||
          JSON.stringify(claim.detected)!==JSON.stringify(detected))throw failure("AI_TREE_RESPONSE_MISMATCH");
        await stillCurrent(detected,ctx);
        if(!claim.publication)throw failure("AI_TREE_NOT_PUBLISHED");
        const p=claim.publication;
        const same=saved && saved.aiId===claim.aiId && saved.version===p.version && saved.sha256===p.sha256;
        const body=p.body ?? (same?saved.body:null);
        if(!body || !validateBody(body) || !body.root || await digest(body)!==p.sha256)throw failure("AI_TREE_HASH_MISMATCH");
        if(saved?.aiId===claim.aiId && (p.version<saved.version || (p.version===saved.version && p.sha256!==saved.sha256)))throw failure("AI_TREE_VERSION_REGRESSION");
        const next={aiId:claim.aiId,version:p.version,sha256:p.sha256,format:p.format,body:clone(body),
          envelope:p.body?clone(envelope):clone(saved.envelope),checkedAt:now()};
        await install(next,detected,ctx);return next;
      })();
      flights.set(key,pending);
      try{return clone(await pending);}finally{if(flights.get(key)===pending)flights.delete(key);}
    }
    async function validatePinned(input,pin) {
      const detected={family:input.family,surface:input.surface,variant:input.variant??null};
      const ctx=await authorize(detected);if(!ctx)throw failure("AI_TREE_ACCESS_REQUIRED");
      await load();
      if(!pin || state.aliases[aliasKey(ctx,detected)]!==pin.aiId)throw failure("AI_TREE_PIN_ID_MISMATCH");
      const verified=await validateEntry(pin,ctx,detected);
      await stillCurrent(detected,ctx);return clone(verified);
    }
    return Object.freeze({get,validatePinned});
  }
  globalThis.OctoportPromptTrees=Object.freeze({validateBody,canonicalBody,digest,render,createCache});
})();
