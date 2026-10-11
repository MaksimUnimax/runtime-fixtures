import { describe, expect, it, vi } from "vitest";
import { BootstrapError, type BootstrapService } from "@product/bootstrap";
import type { ExtensionAuthService } from "@product/extension-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost:5432/test",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 3000,
  workerReadyDelayMs: 0,
};
const principal = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const identified = {
  extensionVersion: "1.2.3",
  browser: { family: "chrome", version: "120" },
  deviceId: principal.deviceId,
  lastConfigVersion: null,
};
const envelope = (version: 1 | 2 | 3) => ({
  envelopeVersion: `bootstrap_envelope_v${version}`,
  algorithm: "Ed25519",
  keyId: "config-key",
  payload: "eA",
  signature: "c2ln",
});

describe("bootstrap version negotiation", () => {
  it("routes v1, v2, and standalone v3 to their producers and rejects unknown versions", async () => {
    const service = {
      issue: vi.fn(async () => envelope(1)),
      issueV2: vi.fn(async () => envelope(2)),
      issueV3: vi.fn(async () => envelope(3)),
    };
    const auth = {
      authenticateAccess: vi.fn(async () => ({
        ok: true as const,
        value: principal,
      })),
    };
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: auth as unknown as ExtensionAuthService,
      bootstrapService: service as unknown as BootstrapService,
    });
    for (const [version, expectedStatus] of [
      ["control_plane_v1", 200],
      ["control_plane_v2", 200],
      ["control_plane_v3", 200],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/bootstrap",
        headers: { authorization: "Bearer synthetic-access-token" },
        payload: {
          ...identified,
          contractVersion: version,
        },
      });
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json().envelopeVersion).toBe(
        `bootstrap_envelope_v${version.slice(-1)}`,
      );
    }
    expect(service.issue).toHaveBeenCalledOnce();
    expect(service.issueV2).toHaveBeenCalledOnce();
    expect(service.issueV3).toHaveBeenCalledOnce();
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/bootstrap",
      headers: { authorization: "Bearer synthetic-access-token" },
      payload: { ...identified, contractVersion: "control_plane_v99" },
    });
    expect(unknown.statusCode).toBe(400);
    expect(service.issueV3).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe("R3 tree transport gates",()=>{
  it("authenticates every tree request, supports v2/v3, rejects v1 and does not cache bootstrap responses",async()=>{
    const treeEnvelope={treeEnvelopeVersion:"ai_prompt_tree_envelope_v1",algorithm:"Ed25519",keyId:"config-key",payload:"eA",signature:"eA"};
    const service={issue:vi.fn(async()=>envelope(1)),issueV2:vi.fn(async()=>envelope(2)),issueV3:vi.fn(async()=>envelope(3)),issuePromptTree:vi.fn(async()=>treeEnvelope)};
    let active=true;const auth={authenticateAccess:vi.fn(async()=>active?{ok:true as const,value:{...principal,sessionId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}}:{ok:false as const,code:"EXTENSION_AUTH_UNAUTHORIZED"})};
    const app=createApiApp({config,isInfrastructureReady:async()=>true,extensionAuthService:auth as unknown as ExtensionAuthService,bootstrapService:service as unknown as BootstrapService});
    try {
      for(const contractVersion of ["control_plane_v2","control_plane_v3"]){
        const response=await app.inject({method:"POST",url:"/v1/ai-prompt-tree",headers:{authorization:"Bearer fixture-access"},payload:{bootstrap:{...identified,contractVersion,detectedAi:{family:"chatgpt",surface:"web",variant:null}},requestNonce:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",known:null}});
        expect(response.statusCode).toBe(200);expect(response.headers["cache-control"]).toBe("no-store");
      }
      expect(service.issuePromptTree).toHaveBeenCalledTimes(2);
      const incompatible=await app.inject({method:"POST",url:"/v1/ai-prompt-tree",headers:{authorization:"Bearer fixture-access"},payload:{bootstrap:{...identified,contractVersion:"control_plane_v1"},requestNonce:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",known:null}});
      expect(incompatible.statusCode).toBe(400);expect(service.issuePromptTree).toHaveBeenCalledTimes(2);
      for(const contractVersion of ["control_plane_v2","control_plane_v3"]){
        const allow=await app.inject({method:"POST",url:"/v1/bootstrap",headers:{authorization:"Bearer fixture-access"},payload:{...identified,contractVersion}});
        expect(allow.statusCode).toBe(200);expect(allow.headers["cache-control"]).toBe("no-store");
      }
      active=false;
      const denied=await app.inject({method:"POST",url:"/v1/bootstrap",headers:{authorization:"Bearer fixture-access"},payload:{...identified,contractVersion:"control_plane_v2"}});
      expect(denied.statusCode).toBe(401);expect(denied.headers["cache-control"]).toBe("no-store");
      const treeDenied=await app.inject({method:"POST",url:"/v1/ai-prompt-tree",headers:{authorization:"Bearer fixture-access"},payload:{bootstrap:{...identified,contractVersion:"control_plane_v2",detectedAi:{family:"chatgpt",surface:"web",variant:null}},requestNonce:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",known:null}});
      expect(treeDenied.statusCode).toBe(401);expect(treeDenied.headers["cache-control"]).toBe("no-store");expect(service.issuePromptTree).toHaveBeenCalledTimes(2);
    } finally {await app.close();}
  });
});

describe('R3 tree typed security denials',()=>{
 for(const [code,status,wire] of [['ACCESS_DENIED',403,'BOOTSTRAP_UNAVAILABLE'],['DEVICE_MISMATCH',403,'DEVICE_MISMATCH'],['UNAVAILABLE',503,'SERVICE_UNAVAILABLE']] as const)
  it(`preserves ${code} security scope and no-store`,async()=>{
   const service={issuePromptTree:async()=>{throw new BootstrapError(code);}};
   const auth={authenticateAccess:async()=>({ok:true as const,value:{...principal,sessionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}})};
   const app=createApiApp({config,isInfrastructureReady:async()=>true,extensionAuthService:auth as unknown as ExtensionAuthService,bootstrapService:service as unknown as BootstrapService});
   try{
    const response=await app.inject({method:'POST',url:'/v1/ai-prompt-tree',headers:{authorization:'Bearer fixture-access'},payload:{bootstrap:{...identified,contractVersion:'control_plane_v2',detectedAi:{family:'chatgpt',surface:'web',variant:null}},requestNonce:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',known:null}});
    expect(response.statusCode).toBe(status);expect(response.json().error.code).toBe(wire);expect(response.headers['cache-control']).toBe('no-store');
   }finally{await app.close();}
  });
});
