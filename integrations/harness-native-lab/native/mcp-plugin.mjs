import { importRuntime } from './runtime-import.mjs';

export const name = 'harness-native-lab-mcp';
export const inject = ['tools'];

export async function apply(ctx, config) {
  const plugin = await importRuntime('@deepseek-ai/dsh-mcp-client');
  const fiber = ctx.plugin(plugin, config);
  await fiber.await();
  if (fiber._error) throw fiber._error;
  const required = ['lab_capabilities', 'yandex_collect_phrases', 'marketplace_orders_report', 'marketplace_stock_snapshot'];
  for (const raw of required) {
    if (!ctx.tools.get(`mcp__business__${raw}`)) throw new Error(`MCP did not register required tool ${raw}`);
  }
  // agent-loop explicitly injects this marker, so missing MCP cannot look ready.
  ctx.provide('labMcpReady', true);
}
