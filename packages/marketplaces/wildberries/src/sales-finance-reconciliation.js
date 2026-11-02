(() => {
  "use strict";
  // Standalone, transient reconciliation. This file registers no runtime hook,
  // performs no request and writes no storage. Activation needs an explicit owner.
  const MAX = Object.freeze({ pageBytes: 3000000, bytes: 8000000, pages: 32, rows: 20000, ttlMs: 300000, outputBytes: 8000000 });
  const FIELDS = Object.freeze(["reportId","currency","rrdId","nmId","srid","dateFrom","dateTo","createDate","orderDt","saleDt","rrDate","sellerOperName","docTypeName","quantity","retailAmount","forPay"]);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const copy = x => JSON.parse(JSON.stringify(x));
  const same = (a,b) => stable(a) === stable(b);
  function stable(x) {
    if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map(k => JSON.stringify(k)+":"+stable(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  async function hash(text) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2,"0")).join("");
  }
  class WireNumber { constructor(lexeme) { this.lexeme = lexeme; } }
  function parseWire(raw) {
    let i=0, nodes=0;
    function ws() { while (/[ \t\r\n]/.test(raw[i] || "\0")) i++; }
    function string() {
      const start=i++;
      while (i<raw.length) {
        if (raw[i]==="\\") { i+=2; continue; }
        if (raw[i++]==='"') { try { return JSON.parse(raw.slice(start,i)); } catch { fail("INVALID_JSON"); } }
      }
      fail("INVALID_JSON");
    }
    function value(depth) {
      if (++nodes>200000 || depth>32) fail("JSON_LIMIT");
      ws();
      if(raw[i]==='"') return string();
      if(raw[i]==="[") {
        i++; ws(); const out=[];
        if(raw[i]==="]") {i++;return out;}
        for(;;) { out.push(value(depth+1));ws();const c=raw[i++];if(c==="]")return out;if(c!==",")fail("INVALID_JSON"); }
      }
      if(raw[i]==="{") {
        i++;ws();const out=Object.create(null);
        if(raw[i]==="}") {i++;return out;}
        for(;;) {
          ws();if(raw[i]!=='"')fail("INVALID_JSON");const k=string();
          if(Object.hasOwn(out,k) || ["__proto__","constructor","prototype"].includes(k))fail("UNSAFE_OR_DUPLICATE_JSON_KEY");
          ws();if(raw[i++]!==":")fail("INVALID_JSON");out[k]=value(depth+1);ws();
          const c=raw[i++];if(c==="}")return out;if(c!==",")fail("INVALID_JSON");
        }
      }
      for(const [token,v] of [["true",true],["false",false],["null",null]]) {
        if(raw.startsWith(token,i)) {i+=token.length;return v;}
      }
      const m=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i));
      if(!m || m.index!==0)fail("INVALID_JSON");
      i+=m[0].length;return new WireNumber(m[0]);
    }
    const result=value(0);ws();if(i!==raw.length)fail("INVALID_JSON");return result;
  }
  function text(x, required=true) {
    if(x===undefined && !required)return null;
    if(typeof x!=="string" || !x.trim().length || x.length>512 || /[\u0000-\u001f\u007f]/u.test(x))fail("INVALID_TEXT_FIELD");
    return x;
  }
  function id(x) {
    if(!(x instanceof WireNumber) || !/^(?:0|[1-9]\d*)$/.test(x.lexeme) || x.lexeme.length>40)fail("INVALID_ID_WIRE_TYPE");
    return x.lexeme;
  }
  function money(x, numeric) {
    if(x===undefined || x===null)return null;
    const s=numeric ? (x instanceof WireNumber ? x.lexeme : null) : (typeof x==="string" ? x : null);
    // Unsupported exponent/scale is rejected, never rounded or coerced.
    if(s===null || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(s) || s.length>80)fail("INVALID_MONEY_LEXEME");
    return s;
  }
  function sum(values) {
    if(values.some(x=>x===null))return null;
    const scale=Math.max(2,...values.map(x=>(x.split(".")[1]||"").length));
    let units=0n;
    for(const x of values) {
      const negative=x.startsWith("-"),[a,b=""]=(negative?x.slice(1):x).split(".");
      units+=(negative?-1n:1n)*BigInt(a+b.padEnd(scale,"0"));
    }
    const negative=units<0n, digits=(negative?-units:units).toString().padStart(scale+1,"0");
    return (negative?"-":"")+digits.slice(0,-scale)+"."+digits.slice(-scale);
  }
  function calendar(s) {
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
    if(!m)fail("INVALID_DATETIME");
    const n=m.slice(1,7).map(Number), ms=Number((m[7]||"").padEnd(3,"0"));
    const utc=Date.UTC(n[0],n[1]-1,n[2],n[3],n[4],n[5],ms), d=new Date(utc);
    if(n[0]<1000 || d.getUTCFullYear()!==n[0] || d.getUTCMonth()+1!==n[1] || d.getUTCDate()!==n[2] || d.getUTCHours()!==n[3] || d.getUTCMinutes()!==n[4] || d.getUTCSeconds()!==n[5])fail("INVALID_DATETIME");
    return { wall:s.slice(0,19), utc, ms, offset:m[8]||null };
  }
  function clockFor(zone) {
    let formatter;
    try { formatter=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}); } catch { fail("INVALID_TIMEZONE"); }
    const wall=t=>{
      const p=Object.fromEntries(formatter.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
      return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second;
    };
    function instant(s) {
      text(s);const p=calendar(s);
      if(p.offset) {
        if(p.offset!=="Z" && (Number(p.offset.slice(1,3))>23 || Number(p.offset.slice(4))>59))fail("INVALID_DATETIME");
        const t=Date.parse(s);if(!Number.isFinite(t))fail("INVALID_DATETIME");return t;
      }
      const offsets=new Set();
      for(const hours of [-36,-24,-12,0,12,24,36]) {
        const t=p.utc+hours*3600000;
        offsets.add(calendar(wall(t)).utc-t+p.ms);
      }
      const candidates=[...offsets].map(o=>p.utc-o).filter(t=>wall(t)===p.wall);
      if(candidates.length!==1)fail("AMBIGUOUS_OR_NONEXISTENT_LOCAL_TIME");
      return candidates[0];
    }
    return {instant,wall};
  }
  function prepareScope(input) {
    if(!input || typeof input!=="object" || Array.isArray(input))fail("INVALID_SCOPE");
    const allowed=["marketplace","accountId","storeId","bindingId","bindingRevision","workSessionId","businessPeriod","salesAcquisition","financeAcquisition","sellerCurrency","sellerCurrencyProvenance","snapshotConsistency"];
    if(Object.keys(input).some(k=>!allowed.includes(k)))fail("UNEXPECTED_SCOPE_FIELD");
    const s=copy(input);
    if(s.marketplace!=="wildberries")fail("MARKETPLACE_MISMATCH");
    for(const k of ["accountId","storeId","bindingId","workSessionId"])text(s[k]);
    if(!Number.isSafeInteger(s.bindingRevision) || s.bindingRevision<0)fail("INVALID_BINDING_REVISION");
    const p=s.businessPeriod;if(!p)fail("MISSING_PERIOD");
    const nested=[[p,["fromInclusive","toExclusive","timezone"]],[s.salesAcquisition,["updatedSince","flag","serverUpperBoundParameter","capturedAt"]],[s.financeAcquisition,["dateFrom","dateTo","period","dateToInclusivity"]]];
    for(const [object,keys] of nested)if(!object || typeof object!=="object" || Array.isArray(object) || Object.keys(object).some(k=>!keys.includes(k)))fail("UNEXPECTED_SCOPE_FIELD");
    text(s.sellerCurrencyProvenance);text(s.snapshotConsistency);text(s.financeAcquisition.dateToInclusivity);
    const clock=clockFor(text(p.timezone)), start=clock.instant(text(p.fromInclusive)),end=clock.instant(text(p.toExclusive));
    if(!calendar(p.fromInclusive).offset || !calendar(p.toExclusive).offset || clock.wall(start)!==p.fromInclusive.slice(0,19) || clock.wall(end)!==p.toExclusive.slice(0,19) || end<=start)fail("PERIOD_TIMEZONE_MISMATCH");
    if(s.salesAcquisition?.flag!==0 || s.salesAcquisition.serverUpperBoundParameter!==null)fail("UNSUPPORTED_SALES_ACQUISITION");
    clock.instant(text(s.salesAcquisition.updatedSince));clock.instant(text(s.salesAcquisition.capturedAt));
    if(!s.financeAcquisition || s.financeAcquisition.dateFrom!==p.fromInclusive || s.financeAcquisition.dateTo!==p.toExclusive || !["daily","weekly"].includes(s.financeAcquisition.period))fail("FINANCE_PERIOD_MISMATCH");
    // No caller-supplied sales currency/FX may be substituted for source evidence.
    if(s.sellerCurrency!==null)fail("OPERATIONAL_CURRENCY_PROVENANCE_NOT_SUPPORTED");
    return {scope:s,clock,start,end};
  }
  async function createCollection({scope,now=()=>Date.now(),ttlMs=MAX.ttlMs}={}) {
    if(typeof now!=="function" || !Number.isSafeInteger(ttlMs) || ttlMs<1 || ttlMs>MAX.ttlMs)fail("INVALID_LEASE");
    const started=now();if(!Number.isFinite(started))fail("INVALID_CLOCK");
    const prepared=prepareScope(scope), s=prepared.scope, scopeKey=stable(s),scopeSha256=await hash(JSON.stringify(s));
    if(!Number.isFinite(now()) || now()<started || now()-started>=ttlMs)fail("COLLECTION_EXPIRED");
    let state="OPEN",busy=false,bytes=0,pageCount=0,rowCount=0,lastNow=started;
    const streams=Object.fromEntries(["sales","finance"].map(k=>[k,{pages:[],rows:new Map(),duplicates:[],terminal:false,cursor:k==="sales"?s.salesAcquisition.updatedSince:"0",rawRows:0}]));
    function clear() { for(const v of Object.values(streams)) {v.rows.clear();v.pages.length=0;v.duplicates.length=0;} }
    function guard() {
      const t=now();
      if(state!=="OPEN")fail("COLLECTION_"+state);
      if(!Number.isFinite(t) || t<lastNow || t-started>=ttlMs) {state="EXPIRED";clear();fail("COLLECTION_EXPIRED");}
      lastNow=t;
    }
    function project(row,stream,where) {
      if(!row || typeof row!=="object" || Array.isArray(row) || row instanceof WireNumber)fail("INVALID_ROW");
      const base={nmId:id(row.nmId),srid:text(row.srid,false),provenance:[where]};
      if(stream==="sales") {
        const date=text(row.date),lastChangeDate=text(row.lastChangeDate);
        return {...base,saleID:text(row.saleID),date,lastChangeDate,eventInstant:new Date(prepared.clock.instant(date)).toISOString(),
          finishedPrice:money(row.finishedPrice,true),forPay:money(row.forPay,true)};
      }
      const dateFrom=text(row.dateFrom),dateTo=text(row.dateTo);
      if(dateFrom!==s.financeAcquisition.dateFrom || dateTo!==s.financeAcquisition.dateTo)fail("ROW_REPORT_PERIOD_MISMATCH");
      const currency=text(row.currency);if(!/^[A-Z]{3}$/.test(currency))fail("INVALID_CURRENCY");
      const out={...base,reportId:id(row.reportId),rrdId:id(row.rrdId),currency,dateFrom,dateTo,
        createDate:text(row.createDate),orderDt:text(row.orderDt),saleDt:text(row.saleDt),rrDate:text(row.rrDate),
        sellerOperName:text(row.sellerOperName),docTypeName:text(row.docTypeName),quantity:id(row.quantity),
        retailAmount:money(row.retailAmount,false),forPay:money(row.forPay,false)};
      for(const k of ["createDate","orderDt","saleDt","rrDate"])prepared.clock.instant(out[k]);
      return {...out,eventInstant:new Date(prepared.clock.instant(out.saleDt)).toISOString()};
    }
    async function observe(frame,{assertSafeValues}={}) {
      guard();if(busy)fail("CONCURRENT_OBSERVATION");busy=true;
      try {
        if(!frame || stable(frame.scope)!==scopeKey || frame.scopeSha256!==scopeSha256)fail("CONTEXT_FENCE_MISMATCH");
        const {stream,pageId,ordinal,previousPageId,previousResponseSha256}=frame;
        // Snapshot only the allowlisted observation, never the authenticated request.
        // Callers may release/mutate callback objects while SHA-256 is awaited.
        if(!frame.command || Object.keys(frame.command).some(k=>!["operation","path","query","body"].includes(k)))fail("OPERATION_MISMATCH");
        const command=copy(frame.command);
        const request={method:frame.request?.method,url:frame.request?.url,body:frame.request?.body};
        const response={rawText:frame.response?.rawText,byteLength:frame.response?.byteLength,httpStatus:frame.response?.httpStatus,responseMeta:{content_type:frame.response?.responseMeta?.content_type}};
        if(!Object.hasOwn(streams,stream))fail("INVALID_STREAM");
        const v=streams[stream], previous=v.pages.at(-1);text(pageId);
        if(v.terminal || ordinal!==v.pages.length+1 || previousPageId!==(previous?.pageId??null) || previousResponseSha256!==(previous?.sha256??null))fail("PAGE_CHAIN_MISMATCH");
        if(Object.values(streams).some(v=>v.pages.some(p=>p.pageId===pageId)))fail("DUPLICATE_PAGE_ID");
        const sales=stream==="sales";
        if(command?.operation!==(sales?"statistics_sales":"finance_sales_detail_period") || Object.keys(command.path||{}).length)fail("OPERATION_MISMATCH");
        let requestUrl;try {requestUrl=new URL(request.url);}catch{fail("REQUEST_MISMATCH");}
        if(requestUrl.protocol!=="https:" || requestUrl.username || requestUrl.password || requestUrl.port || requestUrl.hash || requestUrl.hostname!==(sales?"statistics-api.wildberries.ru":"finance-api.wildberries.ru") || requestUrl.pathname!==(sales?"/api/v1/supplier/sales":"/api/finance/v1/sales-reports/detailed") || request.method!==(sales?"GET":"POST"))fail("REQUEST_MISMATCH");
        if(sales) {
          const q=command.query;
          if(!q || q.flag!==0 || q.dateFrom!==v.cursor || Object.keys(q).some(k=>!["dateFrom","flag"].includes(k)) || command.body!==undefined || !same([...requestUrl.searchParams.entries()].sort(),[["dateFrom",v.cursor],["flag","0"]]))fail("SALES_CURSOR_MISMATCH");
        } else {
          const b=command.body;
          if(!b || !Number.isSafeInteger(b.rrdId) || String(b.rrdId)!==v.cursor || !Number.isSafeInteger(b.limit) || b.limit<1 || b.limit>100000 || (!Array.isArray(b.fields) || !same([...b.fields].sort(),[...FIELDS].sort())) || Object.keys(command.query||{}).length || requestUrl.search)fail("FINANCE_CURSOR_OR_FIELDS_MISMATCH");
          if(Object.keys(b).some(k=>!["dateFrom","dateTo","limit","rrdId","period","fields"].includes(k)))fail("FINANCE_REQUEST_FIELD_MISMATCH");
          for(const k of ["dateFrom","dateTo","period"])if(b[k]!==s.financeAcquisition[k])fail("FINANCE_PERIOD_MISMATCH");
          let requestBody;
          try { requestBody=typeof request.body==="string"?JSON.parse(request.body):null; } catch { fail("REQUEST_BODY_MISMATCH"); }
          if(!same(requestBody,b))fail("REQUEST_BODY_MISMATCH");
        }
        const raw=response?.rawText;
        if(typeof raw!=="string" || new TextEncoder().encode(raw).byteLength!==response.byteLength || response.byteLength>MAX.pageBytes || ++pageCount>MAX.pages || (bytes+=response.byteLength)>MAX.bytes)fail("RESPONSE_SIZE_LIMIT_OR_MISMATCH");
        const emptyFinanceTerminal=!sales && response.httpStatus===204 && raw==="" && response.byteLength===0;
        if(!emptyFinanceTerminal && !/(?:^|[+/])json(?:;|$)/i.test(response.responseMeta?.content_type||""))fail("CONTENT_TYPE_MISMATCH");
        const rawHash=await hash(raw);guard();
        let rows;
        if(emptyFinanceTerminal) {rows=[];v.terminal=true;}
        else if(response.httpStatus===200) {
          rows=parseWire(raw);if(!Array.isArray(rows))fail("EXPECTED_ROW_ARRAY");
          if(rows.length===0) {if(!sales)fail("FINANCE_EMPTY_200_NOT_TERMINAL");v.terminal=true;}
        } else fail("UNSUPPORTED_HTTP_RESPONSE");
        if((rowCount+=rows.length)>MAX.rows)fail("ROW_LIMIT");
        const page={pageId,ordinal,sha256:rawHash,bytes:response.byteLength,httpStatus:response.httpStatus,
          commandSha256:await hash(stable(command)),rows:rows.length};
        guard();
        // Project the whole page into transient local values, then require the
        // application veto before retaining rows/cursors in collection state.
        const projected=rows.map((row,index)=>project(row,stream,{pageId,row:index+1,rawResponseSha256:rawHash}));
        if(assertSafeValues!==undefined) {
          if(typeof assertSafeValues!=="function")fail("VALUE_SAFETY_REQUIRED");
          await assertSafeValues(projected);guard();
        }
        for(let index=0;index<projected.length;index++) {
          const out=projected[index];
          const key=sales?out.saleID:out.rrdId,prior=v.rows.get(key);
          if(prior) {
            const a={...out,provenance:[]},b={...prior,provenance:[]};
            if(!same(a,b))fail("CONFLICTING_DUPLICATE");
            prior.provenance.push(...out.provenance);v.duplicates.push({key,pageId,row:index+1});
          } else v.rows.set(key,out);
          if(sales) {
            const t=prepared.clock.instant(out.lastChangeDate);
            if(t<prepared.clock.instant(v.cursor))fail("SALES_CURSOR_REGRESSION");
            v.cursor=out.lastChangeDate;
          } else {
            if(BigInt(out.rrdId)<BigInt(v.cursor))fail("FINANCE_CURSOR_REGRESSION");
            if(BigInt(out.rrdId)>BigInt(Number.MAX_SAFE_INTEGER))fail("CURSOR_UNREPRESENTABLE_BY_EXISTING_COMMAND");
            v.cursor=out.rrdId;
          }
        }
        if(rows.length && (sales ? prepared.clock.instant(v.cursor)<=prepared.clock.instant(command.query.dateFrom) : BigInt(v.cursor)<=BigInt(command.body.rrdId)))fail("CURSOR_DID_NOT_ADVANCE");
        guard();v.rawRows+=rows.length;v.pages.push(page);
        return copy({...page,nextCursor:v.cursor,terminal:v.terminal});
      } catch(error) {state="INVALID";clear();throw error;} finally {busy=false;}
    }
    function finish() {
      guard();if(busy)fail("OBSERVATION_IN_FLIGHT");
      if(Object.values(streams).some(v=>!v.terminal))fail("TRANSPORT_INCOMPLETE");
      const sales=[...streams.sales.rows.values()],finance=[...streams.finance.rows.values()];
      const reports=new Map();
      for(const r of finance) {
        const previous=reports.get(r.reportId);
        if(previous && previous!==r.currency) {state="INVALID";clear();fail("REPORT_CURRENCY_CONFLICT");}
        reports.set(r.reportId,r.currency);
      }
      for(const r of [...sales,...finance]) {
        const t=Date.parse(r.eventInstant);r.inBusinessEventPeriod=t>=prepared.start && t<prepared.end;
      }
      const key=r=>r.srid===null?null:stable([r.nmId,r.srid,r.eventInstant]);
      const groups=new Map();
      for(const [side,rows] of [["sales",sales],["finance",finance]])for(const r of rows) {
        const k=key(r);if(k===null)continue;
        if(!groups.has(k))groups.set(k,{sales:[],finance:[]});
        groups.get(k)[side].push(r);
      }
      const links=[],ambiguous=[],linkedSales=new Set(),linkedFinance=new Set();
      for(const [k,g] of groups) {
        if(g.sales.length===1 && g.finance.length===1) {
          const a=g.sales[0],b=g.finance[0];links.push({saleID:a.saleID,rrdId:b.rrdId,nmId:a.nmId,srid:a.srid,eventInstant:a.eventInstant,inBusinessEventPeriod:a.inBusinessEventPeriod,financeCurrency:b.currency,financeOperation:b.sellerOperName,amountComparison:"UNAVAILABLE_OPERATIONAL_CURRENCY_NOT_SUPPLIED"});
          linkedSales.add(a.saleID);linkedFinance.add(b.rrdId);
        } else if(g.sales.length && g.finance.length)ambiguous.push({key:JSON.parse(k),saleIDs:g.sales.map(r=>r.saleID),rrdIds:g.finance.map(r=>r.rrdId),reason:"NON_UNIQUE_EVENT_KEY_NO_CARTESIAN_JOIN"});
      }
      const totalGroups=new Map();
      for(const r of finance) {
        // Report-period sums preserve source signs. Labels are retained verbatim;
        // return signs and final revenue are deliberately not invented.
        const k=stable([r.reportId,r.currency,r.sellerOperName,r.docTypeName,r.inBusinessEventPeriod]);
        if(!totalGroups.has(k))totalGroups.set(k,[]);
        totalGroups.get(k).push(r);
      }
      const financeTotals=[...totalGroups.values()].map(rows=>({
        reportId:rows[0].reportId,currency:rows[0].currency,operation:rows[0].sellerOperName,document:rows[0].docTypeName,
        inBusinessEventPeriod:rows[0].inBusinessEventPeriod,rows:rows.length,
        retailAmountSourceSignedSum:sum(rows.map(r=>r.retailAmount)),forPaySourceSignedSum:sum(rows.map(r=>r.forPay)),
        missingRetailAmount:rows.filter(r=>r.retailAmount===null).length,missingForPay:rows.filter(r=>r.forPay===null).length,
        rrdIds:rows.map(r=>r.rrdId)
      }));
      const result={
        schema:"WB_SALES_FINANCE_RECONCILIATION_V1",scope:copy(s),scopeSha256,
        grain:"CONTEXT + nmId + srid + exact event instant; links only at unique 1:1 cardinality",
        coverage:{transportChainsTerminated:true,businessCoverageProved:false,atomicSnapshotProved:false,financeDateToInclusivity:s.financeAcquisition.dateToInclusivity,
          operationalCurrency:null,FX:null,finalRevenue:null},
        streams:Object.fromEntries(Object.entries(streams).map(([k,v])=>[k,{pages:copy(v.pages),rawRows:v.rawRows,uniqueRows:v.rows.size,duplicates:copy(v.duplicates),terminal:k==="sales"?"200_EMPTY_ARRAY":"204_EMPTY_BODY"}])),
        reportCurrencyProvenance:[...reports].map(([reportId,currency])=>({reportId,currency,source:"finance raw row.currency bound to row.reportId"})),
        sales,finance,links,ambiguous,
        unmatchedSales:sales.filter(r=>!linkedSales.has(r.saleID)).map(r=>({saleID:r.saleID,reason:r.srid===null?"MISSING_SRID":"NO_UNIQUE_FINANCE_EVENT"})),
        unmatchedFinance:finance.filter(r=>!linkedFinance.has(r.rrdId)).map(r=>({rrdId:r.rrdId,reason:"NO_UNIQUE_OPERATIONAL_EVENT"})),
        financeTotals,
        interpretation:["Operational amounts are preliminary and their currency is not supplied; no monetary comparison or FX is calculated.","Financial totals use report period, original row signs, operation labels and currency. They are not net/final revenue.","Business event-period flags use date/saleDt, never lastChangeDate. Transport termination does not prove business completeness."]
      };
      guard();const encoded=JSON.stringify(result);
      if(new TextEncoder().encode(encoded).byteLength>MAX.outputBytes){state="INVALID";clear();fail("OUTPUT_SIZE_LIMIT");}
      guard();state="CLOSED";clear();return JSON.parse(encoded);
    }
    return Object.freeze({observe,finish,invalidate(){state="INVALIDATED";clear();}});
  }
  function renderReport(result, {includeCSV=true}={}) {
    if(result?.schema!=="WB_SALES_FINANCE_RECONCILIATION_V1" || result.coverage?.businessCoverageProved!==false)fail("INVALID_RESULT");
    // Full JSON is the canonical file. CSV is an escaped, allowlisted view only.
    const csv=x=>'"'+String(x??"").replace(/"/g,'""').replace(/^[=+@\t\r-]/,"'$&")+'"';
    const json=JSON.stringify(result,null,2)+"\n";
    if(new TextEncoder().encode(json).byteLength>MAX.outputBytes)fail("OUTPUT_SIZE_LIMIT");
    if(!includeCSV)return {json};
    const rows=[["kind","id","nmId","srid","eventInstant","inBusinessEventPeriod","reportId","currency","operation","finishedPrice","retailAmount","forPay"]];
    for(const r of result.sales)rows.push(["sales",r.saleID,r.nmId,r.srid,r.eventInstant,r.inBusinessEventPeriod,"","","",r.finishedPrice,"",r.forPay]);
    for(const r of result.finance)rows.push(["finance",r.rrdId,r.nmId,r.srid,r.eventInstant,r.inBusinessEventPeriod,r.reportId,r.currency,r.sellerOperName,"",r.retailAmount,r.forPay]);
    const csvText=rows.map(r=>r.map(csv).join(",")).join("\r\n")+"\r\n";
    if(new TextEncoder().encode(csvText).byteLength>MAX.outputBytes)fail("OUTPUT_SIZE_LIMIT");
    return {json,csv:csvText};
  }
  function parseControlJSON(raw) {
    if(typeof raw!=="string" || new TextEncoder().encode(raw).byteLength>4096)fail("MANIFEST_SIZE_LIMIT");
    function decode(x) {
      if(x instanceof WireNumber) {
        if(!/^(?:0|[1-9]\d*)$/.test(x.lexeme) || !Number.isSafeInteger(Number(x.lexeme)))fail("MANIFEST_INTEGER_INVALID");
        return Number(x.lexeme);
      }
      if(Array.isArray(x))return x.map(decode);
      if(x && typeof x==="object")return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,decode(v)]));
      return x;
    }
    return decode(parseWire(raw));
  }
  globalThis.SellerAgentsWBSalesFinance=Object.freeze({createCollection,renderReport,parseControlJSON,limits:MAX,financeFields:FIELDS});
})();
