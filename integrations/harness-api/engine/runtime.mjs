import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { templateAdapterClass, PROVIDER, MODEL } from './provider.mjs';

export function harnessRequire() {
  return process.env.HARNESS_NODE_MODULES
    ? createRequire(path.join(path.resolve(process.env.HARNESS_NODE_MODULES), '__octoport_resolver__.cjs'))
    : createRequire(import.meta.url);
}

export async function createHarnessRuntime({ stateDirectory, resolveScope, execute, recordResult, recordFailure, deepseekKey }) {
  const resolver = harnessRequire();
  const load = name => import(pathToFileURL(resolver.resolve(`@deepseek-ai/${name}`)).href);
  const { Context } = await load('cordis');
  const { LlmAdapter, LlmError } = await load('dsh-llm');
  const ctx = new Context();
  const mounted = [];
  async function mount(name, config = {}) {
    const module = await load(name);
    const fiber = ctx.plugin(module.default ?? module, config);
    await fiber.await();
    if (fiber._error) throw fiber._error;
    mounted.push(fiber);
    return fiber;
  }
  try {
    const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = await load('dsh-launch-environment');
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: deepseekKey ? { DEEPSEEK_API_KEY: deepseekKey } : {} }]));
    await mount('dsh-llm');
    await mount('dsh-session');
    await mount('dsh-session-projection');
    await mount('dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: '' });
    await mount('dsh-tools');
    await mount('dsh-tool-executor-native');
    await mount('dsh-agent');
    await mount('dsh-session-persistence-jsonl', { root: path.join(stateDirectory, 'harness-sessions'), compression: 'none' });
    await mount('dsh-session-checkpoint-policy');
    if (deepseekKey) await mount('dsh-llm-deepseek-api-key', { apiKeyEnv: 'DEEPSEEK_API_KEY', maxTokens: 4096, modelsMaxAgeMs: 0 });
    const Adapter = templateAdapterClass({ LlmAdapter, LlmError });
    const adapter = new Adapter({ resolveScope, execute, recordResult, recordFailure });
    ctx.llm.registerAdapter([PROVIDER], adapter);
    await mount('dsh-agent-loop', { agents: [], maxParallelToolCalls: 1 });
    const packageFile = resolver.resolve('@deepseek-ai/dsh/package.json');
    const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
    if (version !== '0.2.2-rc.1') throw new Error(`Unexpected Harness runtime version ${version}`);
    return {
      ctx, version, provider: PROVIDER, model: MODEL,
      officialProviderConfigured: Boolean(deepseekKey),
      async create(sessionId) { return ctx.agents.create({ sessionId, agentOptions: { provider: PROVIDER, model: MODEL } }); },
      async resume(sessionId) { return ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: PROVIDER, model: MODEL } }); },
      async flush() { await ctx.sessionPersistence.flush(); },
      async close() {
        for (const fiber of [...mounted].reverse()) await fiber.dispose();
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    for (const fiber of [...mounted].reverse()) await fiber.dispose().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
    throw error;
  }
}
