import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mountPlatformMcp, platformMcpEntry } from './platform-mcp.mjs';

const settings = {
  pythonExecutable: '/local/bin/python', productDirectory: '/local/worker',
  databasePath: '/local/state.sqlite', compositionModule: 'examples.reference_plugin',
  scope: { actorId: 'a', workspaceId: 'w', chatId: 'c' },
};

test('Cordis preset selects official stdio client with a fixed scoped invocation', () => {
  const entry = platformMcpEntry(settings);
  assert.equal(entry.name, '@deepseek-ai/dsh-mcp-client');
  assert.equal(entry.config.command, settings.pythonExecutable);
  assert.equal(entry.config.cwd, settings.productDirectory);
  assert.deepEqual(entry.config.args, [
    '-m', 'platform_core', '--db=/local/state.sqlite',
    '--composition=examples.reference_plugin', 'serve', '--actor=a', '--workspace=w', '--chat=c',
  ]);
  assert.equal(entry.config.transport, 'stdio');
  assert.equal(entry.config.failOnStartupError, true);
  const { compositionModule, ...noPlugins } = settings;
  assert.ok(platformMcpEntry(noPlugins).config.args.every(arg => !arg.startsWith('--composition')));
});

test('refuses incomplete identity, ambiguous paths and invalid composition', () => {
  assert.throws(() => platformMcpEntry({ ...settings, scope: { workspaceId: 'w' } }));
  assert.throws(() => platformMcpEntry({ ...settings, databasePath: 'relative' }));
  assert.throws(() => platformMcpEntry({ ...settings, compositionModule: 'foo/bar' }));
});

test('programmatic mounting awaits Cordis activation and propagates activation failure', async () => {
  const client = {};
  const fiber = { await: async () => { fiber.activated = true; } };
  const ctx = { plugin(plugin, config) {
    assert.equal(plugin, client);
    assert.deepEqual(config, platformMcpEntry(settings).config);
    return fiber;
  } };
  assert.equal(await mountPlatformMcp(ctx, client, settings), fiber);
  assert.equal(fiber.activated, true);
  fiber._error = new Error('activation failed');
  await assert.rejects(mountPlatformMcp(ctx, client, settings), /activation failed/);
});

// Install the native release in a separate runtime and set HARNESS_NODE_MODULES
// to its absolute node_modules directory. The test owns a temporary DB/Context.
test('rc.1 official native client discovers and invokes a real scoped Python stdio tool', {
  skip: !process.env.HARNESS_NODE_MODULES && 'set HARNESS_NODE_MODULES for pinned native runtime',
  timeout: 30_000,
}, async () => {
  const directory = process.env.HARNESS_NODE_MODULES;
  assert.ok(path.isAbsolute(directory), 'HARNESS_NODE_MODULES must be absolute');
  const resolve = createRequire(path.join(directory, '__harness_smoke__.cjs')).resolve;
  const pkg = JSON.parse(await readFile(resolve('@deepseek-ai/dsh/package.json'), 'utf8'));
  assert.equal(pkg.version, '0.2.2-rc.1');
  const load = name => import(pathToFileURL(resolve(`@deepseek-ai/${name}`)).href);
  const { Context } = await load('cordis');
  const ctx = new Context();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'harness-platform-smoke-'));
  try {
    const productDirectory = fileURLToPath(new URL('../', import.meta.url));
    const databasePath = path.join(temporary, 'state.sqlite');
    const pythonExecutable = process.env.HARNESS_TEST_PYTHON ||
      execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
    const compositionModule = 'examples.reference_plugin';
    const globalArgs = ['-m', 'platform_core', '--db', databasePath, '--composition', compositionModule];
    const scopeArgs = ['--actor', 'a', '--workspace', 'w', '--chat', 'c'];
    const cli = (...args) => execFileSync(pythonExecutable, [...globalArgs, ...args], {
      cwd: productDirectory, stdio: 'pipe', timeout: 10_000,
    });
    cli('init', ...scopeArgs);
    cli('grant', '--workspace', 'w', '--plugin', 'reference-text');
    cli('enable', ...scopeArgs, '--plugin', 'reference-text');
    for (const name of ['dsh-system-prompt', 'dsh-tools']) {
      const plugin = await load(name);
      const fiber = ctx.plugin(plugin.default ?? plugin, {});
      await fiber.await();
      if (fiber._error) throw fiber._error;
    }
    await mountPlatformMcp(ctx, await load('dsh-mcp-client'), {
      pythonExecutable, productDirectory, databasePath, compositionModule,
      scope: { actorId: 'a', workspaceId: 'w', chatId: 'c' },
    });
    const tool = ctx.tools.get('mcp__platform__summarize_text');
    assert.ok(tool, 'official plugin should register the dynamically discovered capability');
    assert.deepEqual(tool.parameters.required, ['text']);
    const execution = { signal: AbortSignal.timeout(5_000) };
    const result = await tool.execute({ text: 'two words' }, execution);
    assert.equal(result.structuredContent.result.words, 2);
    cli('revoke', '--workspace', 'w', '--plugin', 'reference-text');
    await assert.rejects(tool.execute({ text: 'again' }, execution), /unavailable/i);
  } finally {
    try {
      await ctx.fiber.dispose();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});
