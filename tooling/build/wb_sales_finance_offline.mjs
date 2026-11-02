// Explicit offline consumer for saved synthetic callback observations.
// Does not load extension runtime, fetch a provider or activate a shared hook.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../packages/marketplaces/wildberries/src/sales-finance-reconciliation.js";
const [input,prefix]=process.argv.slice(2);
if(!input || !prefix || process.argv.length!==4)throw new Error("USAGE: wb_sales_finance_offline.mjs observations.json output-prefix");
const stat=fs.statSync(input);
if(stat.size>12000000)throw new Error("INPUT_SIZE_LIMIT");
const envelope=JSON.parse(fs.readFileSync(input,"utf8"));
if(envelope.schema!=="CAP19_SYNTHETIC_CALLBACK_OBSERVATIONS_V1" || envelope.synthetic!==true || !Array.isArray(envelope.pages))throw new Error("SYNTHETIC_OFFLINE_OBSERVATIONS_REQUIRED");
const api=globalThis.SellerAgentsWBSalesFinance;
const collection=await api.createCollection({scope:envelope.scope});
for(const page of envelope.pages)await collection.observe({...page,scope:envelope.scope});
const result=collection.finish(), files=api.renderReport(result);
for(const [suffix,text] of Object.entries(files)) {
  const destination=path.resolve(prefix+"."+suffix);
  fs.writeFileSync(destination,text,{flag:"wx",mode:0o600});
}
console.log(JSON.stringify({status:"AUTONOMOUS_SYNTHETIC_RECONCILIATION_FILE_CREATED_NOT_RUNTIME_ACTIVATED",links:result.links.length,unmatchedSales:result.unmatchedSales.length,unmatchedFinance:result.unmatchedFinance.length,output:path.resolve(prefix),source:fileURLToPath(import.meta.url)}));
