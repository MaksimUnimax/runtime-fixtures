import path from 'node:path';

/** Construct from backend/operator configuration for a single scoped Agent.
 * Mounting this connection in a host-global shared tool registry would grant
 * other chats access to the same subprocess identity.
 */
export function platformMcpEntry({
  pythonExecutable, productDirectory, databasePath, scope, compositionModule, integrationKeyFile, marketplaceTurn,
}) {
  for (const value of [pythonExecutable, productDirectory, databasePath]) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
      throw new TypeError('Platform MCP requires absolute deployment paths');
    }
  }
  const args = ['-m', 'platform_core', `--db=${databasePath}`];
  if (compositionModule !== undefined) {
    if (typeof compositionModule !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(compositionModule)) {
      throw new TypeError('Invalid deployment composition module');
    }
    args.push(`--composition=${compositionModule}`);
  }
  args.push('serve');
  for (const [option, value] of [
    ['actor', scope?.actorId], ['workspace', scope?.workspaceId], ['chat', scope?.chatId],
  ]) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new TypeError(`Missing or invalid platform scope: ${option}`);
    }
    args.push(`--${option}=${value}`);
  }
  return {
    id: 'harness-platform-mcp',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: 'platform', transport: 'stdio', command: pythonExecutable,
      cwd: productDirectory, args, failOnStartupError: true,
      ...(marketplaceTurn ? {
        // The native turn enforces its live deadline. The SDK requires a finite
        // timer and cannot extend an outstanding tools/call on provider backoff.
        toolCallTimeoutMs: marketplaceTurn.resumeRateLimits ? 2_147_483_647
          : Math.max(1, marketplaceTurn.deadline - Date.now()),
      } : {}),
      ...((integrationKeyFile || marketplaceTurn) ? { env: {
        ...(integrationKeyFile ? { HARNESS_INTEGRATIONS_KEY_FILE: integrationKeyFile } : {}),
        ...(marketplaceTurn ? { HARNESS_MATRIX_TURN: JSON.stringify({ ...marketplaceTurn, databasePath }) } : {}),
      }} : {}),
    },
  };
}

/** For programmatic Cordis compositions; mcpClient comes from the host runtime. */
export async function mountPlatformMcp(ctx, mcpClient, options) {
  const entry = platformMcpEntry(options);
  const fiber = ctx.plugin(mcpClient, entry.config);
  await fiber.await();
  if (fiber._error) throw fiber._error;
  return fiber;
}
