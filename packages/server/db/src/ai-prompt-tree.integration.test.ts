import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime, type DatabaseRuntime, createP7AdminAiCommandRepository, createBootstrapAiResolutionRepository } from "./index.js";
import { runMigrations } from "./migrations.js";
import { createAiPromptTreeRepository } from "./ai-prompt-tree-repository.js";
import { promptTreeDigest } from "@product/admin-ai";
import type { AiPromptTreeV1 } from "@product/contracts";

const url=process.env.R3_TREE_DATABASE_URL;
if(!url || new URL(url).hostname!=="127.0.0.1" || new URL(url).pathname!=="/operator_r3_trees")
  throw new Error("R3 exact isolated database URL required; never use shared DATABASE_URL");
const baseline=process.env.R3_TREE_BASELINE_MIGRATIONS;
if(!baseline?.startsWith("/root/octoport-control/temporary/controller/OPERATOR-R3-PERSONAL-DB-20261010/"))
  throw new Error("R3 isolated baseline migrations required");
const USER="51000000-0000-4000-8000-000000000001",ACTOR="51000000-0000-4000-8000-000000000002";
const AI_A="51000000-0000-4000-8000-000000000003",AI_B="51000000-0000-4000-8000-000000000004";
const tree=(text:string):AiPromptTreeV1=>({format:"octoport_prompt_tree_v1",root:"start",nodes:[{id:"start",text,children:[]}]});
const actor={actorId:ACTOR,correlationId:"r3-tree-db",reason:"Personal R3 isolated test"};
let runtime:DatabaseRuntime;
describe.sequential("AI-TREE PostgreSQL transaction and migration subsets",()=>{
 beforeAll(async()=>{
   runtime=createDatabaseRuntime(url);await runtime.ready();
   await runMigrations({connectionString:url,migrationsDirectory:baseline});
   await runtime.query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')",[USER]);
   await runtime.query("INSERT INTO admin_principals(id,user_id,status) VALUES($1,$2,'ACTIVE')",[ACTOR,USER]);
   await runtime.query("INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OPS')",[ACTOR]);
   await runtime.query("INSERT INTO ai_adapters(id,machine_key,display_name,description) VALUES($1,'tree_existing','Existing AI','Keep original')",[AI_A]);
 },120000);
 afterAll(async()=>{await runtime?.close();});
 it("rolls back an interrupted migration, then upgrades and repeats without changing existing registry data",async()=>{
   const migration=await readFile(new URL("../drizzle/0059_ai_prompt_trees.sql",import.meta.url),"utf8");
   const first=migration.split("--> statement-breakpoint")[0]!;
   await expect(runtime.transaction(async q=>{await q.query(first);throw new Error("simulated interruption");})).rejects.toThrow("simulated interruption");
   expect((await runtime.query("SELECT to_regclass('public.ai_prompt_tree_heads') AS value")).rows[0]!.value).toBeNull();
   await runMigrations({connectionString:url});await runMigrations({connectionString:url});
   expect((await runtime.query("SELECT display_name,description FROM ai_adapters WHERE id=$1",[AI_A])).rows[0]).toEqual({display_name:"Existing AI",description:"Keep original"});
   const r=createAiPromptTreeRepository(runtime);const existing=await r.get(AI_A);
   expect(existing?.draft.root).toBeNull();expect(existing?.publishedVersion).toBe(0);
 });
 it("does not expose a draft before explicit publication and rejects empty publication",async()=>{
   const r=createAiPromptTreeRepository(runtime);
   await expect(r.publish("template",{...actor,expectedDraftRevision:1,expectedPublishedVersion:0})).rejects.toThrow("AI_TREE_INVALID_EMPTY");
   await r.save("template",{...actor,expectedDraftRevision:1,body:tree("Shared starting content")});
   expect((await r.get("template"))?.publishedVersion).toBe(0);
   await r.publish("template",{...actor,expectedDraftRevision:2,expectedPublishedVersion:0});
   expect((await r.get("template"))?.history[0]?.author).toBe(ACTOR);
   const audit=await runtime.query("SELECT target_id,safe_metadata FROM audit_events WHERE action='AI_TREE_PUBLISHED' ORDER BY created_at DESC LIMIT 1");
   expect(audit.rows[0]?.target_id).toBeNull();expect((audit.rows[0]?.safe_metadata as {treeTarget:string}).treeTarget).toBe("template");
 });
 it("atomically copies the published template for old API SQL and new registry creation",async()=>{
   await runtime.query("INSERT INTO ai_adapters(id,machine_key,display_name,description) VALUES($1,'tree_old_client','Old API','Compatibility')",[AI_B]);
   const r=createAiPromptTreeRepository(runtime),b=await r.get(AI_B);
   expect(b?.draft).toEqual(tree("Shared starting content"));expect(b?.templateRevision).toBe(1);expect(b?.publishedVersion).toBe(0);
   const created=await createP7AdminAiCommandRepository(runtime).createAdapter({...actor,machineKey:"tree_new_client",displayName:"New API",description:"Current"});
   expect((await r.get(created.id))?.draft).toEqual(b?.draft);
   await expect(createP7AdminAiCommandRepository(runtime).createAdapter({...actor,machineKey:"tree_new_client",displayName:"Duplicate",description:"Never overwrite"})).rejects.toThrow();
   expect((await r.get(created.id))?.draftRevision).toBe(1);
 });
 it("template edits and one AI's draft do not change other permanent AI IDs",async()=>{
   const r=createAiPromptTreeRepository(runtime);await r.save("template",{...actor,expectedDraftRevision:2,body:tree("Future AIs only")});
   await r.publish("template",{...actor,expectedDraftRevision:3,expectedPublishedVersion:1});
   await r.save(AI_A,{...actor,expectedDraftRevision:1,body:tree("Only existing AI")});
   expect((await r.get(AI_B))?.draft).toEqual(tree("Shared starting content"));
   expect((await r.get(AI_A))?.draft).toEqual(tree("Only existing AI"));
 });
 it("concurrent draft saves have exactly one CAS winner",async()=>{
   const r=createAiPromptTreeRepository(runtime);const result=await Promise.allSettled([
     r.save(AI_A,{...actor,expectedDraftRevision:2,body:tree("Winner A")}),
     r.save(AI_A,{...actor,expectedDraftRevision:2,body:tree("Winner B")}),
   ]);expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(1);
   expect(result.filter(x=>x.status==="rejected")).toHaveLength(1);expect((await r.get(AI_A))?.draftRevision).toBe(3);
 });
 it("concurrent publication has one winner and reader sees matching immutable body/hash",async()=>{
   const r=createAiPromptTreeRepository(runtime);const result=await Promise.allSettled([
     r.publish(AI_A,{...actor,expectedDraftRevision:3,expectedPublishedVersion:0}),
     r.publish(AI_A,{...actor,expectedDraftRevision:3,expectedPublishedVersion:0}),
   ]);expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(1);
   const pub=await createBootstrapAiResolutionRepository(runtime).promptTree(AI_A);
   expect(pub?.version).toBe(1);expect(pub?.sha256).toBe(promptTreeDigest(pub?.body));expect(pub?.aiId).toBe(AI_A);
 });
 it("publication rows cannot be overwritten or deleted",async()=>{
   await expect(runtime.query("UPDATE ai_prompt_tree_publications SET content_sha256=repeat('a',64) WHERE target=$1",[AI_A])).rejects.toThrow("AI_TREE_PUBLICATION_IMMUTABLE");
   await expect(runtime.query("DELETE FROM ai_prompt_tree_publications WHERE target=$1",[AI_A])).rejects.toThrow("AI_TREE_PUBLICATION_IMMUTABLE");
 });
 it("rollback creates a newer publication and invalidates stale editor revisions",async()=>{
   const r=createAiPromptTreeRepository(runtime),first=await createBootstrapAiResolutionRepository(runtime).promptTree(AI_A);
   await r.save(AI_A,{...actor,expectedDraftRevision:3,body:tree("Second publication")});
   await r.publish(AI_A,{...actor,expectedDraftRevision:4,expectedPublishedVersion:1});
   const state=await r.publish(AI_A,{...actor,expectedDraftRevision:4,expectedPublishedVersion:2,sourceVersion:1});
   expect(state.publishedVersion).toBe(3);expect(state.draftRevision).toBe(5);expect(state.history[0]?.sourceVersion).toBe(1);
   expect(state.history[0]?.sha256).toBe(first?.sha256);expect(state.history).toHaveLength(3);
   await expect(r.save(AI_A,{...actor,expectedDraftRevision:4,body:tree("Stale edit")})).rejects.toThrow("P7_STATE_STALE");
 });
 it("current transaction permission rejects a suspended actor without changing state",async()=>{
   const r=createAiPromptTreeRepository(runtime),before=await r.get(AI_A);
   await runtime.query("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1",[ACTOR]);
   try{await expect(r.save(AI_A,{...actor,expectedDraftRevision:5,body:tree("Forbidden")})).rejects.toThrow("ADMIN_FORBIDDEN");}
   finally{await runtime.query("UPDATE admin_principals SET status='ACTIVE' WHERE id=$1",[ACTOR]);}
   expect(await r.get(AI_A)).toEqual(before);
 });
 it("audit failure rolls back publication and head together",async()=>{
   const r=createAiPromptTreeRepository(runtime),before=await r.get(AI_A);
   await runtime.query(`CREATE FUNCTION r3_fail_tree_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF NEW.action='AI_TREE_PUBLISHED' THEN RAISE EXCEPTION 'R3_SIMULATED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
     CREATE TRIGGER r3_fail_tree_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION r3_fail_tree_audit()`);
   try{await expect(r.publish(AI_A,{...actor,expectedDraftRevision:5,expectedPublishedVersion:3})).rejects.toThrow("R3_SIMULATED_AUDIT_FAILURE");}
   finally{await runtime.query("DROP TRIGGER r3_fail_tree_audit ON audit_events; DROP FUNCTION r3_fail_tree_audit()");}
   expect(await r.get(AI_A)).toEqual(before);
 });
 it("repeat migration preserves all committed drafts, publications and registry IDs",async()=>{
   const r=createAiPromptTreeRepository(runtime),before=await r.get(AI_A);await runMigrations({connectionString:url});
   expect(await r.get(AI_A)).toEqual(before);expect((await r.get(AI_B))?.draft).toEqual(tree("Shared starting content"));
 });
});
