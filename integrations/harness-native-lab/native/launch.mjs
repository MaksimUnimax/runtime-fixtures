import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { assertRuntime } from './runtime-import.mjs';
import { buildProfile, PROFILE_NAME } from './config.mjs';

function absolute(value, name) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path.resolve(value);
}
export function privateFile(file, name, credentialsDirectory = process.env.CREDENTIALS_DIRECTORY) {
  const stat = fs.lstatSync(file);
  let systemdCredential = false;
  if (credentialsDirectory && path.isAbsolute(credentialsDirectory)) {
    const directory = path.resolve(credentialsDirectory);
    if (directory.startsWith('/run/credentials/') && path.dirname(path.resolve(file)) === directory) {
      const parent = fs.lstatSync(directory);
      systemdCredential = parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o022) === 0;
    }
  }
  // systemd credential mounts can be root:root 0440 with service ACL/idmapping.
  // Only this explicitly declared protected directory admits group-read access.
  const forbidden = systemdCredential ? 0o137 : 0o177;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & forbidden) !== 0) throw new Error(`${name} must be a private regular file (0600, or a protected systemd credential)`);
}
function atomicWrite(file, content) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function optionsFromEnvironment(env = process.env) {
  const home = absolute(env.HARNESS_LAB_HOME, 'HARNESS_LAB_HOME');
  const modules = absolute(env.HARNESS_NODE_MODULES, 'HARNESS_NODE_MODULES');
  const gateway = new URL(env.HARNESS_LAB_GATEWAY_URL ?? 'http://127.0.0.1:18442');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname) || gateway.protocol !== 'http:' || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error('Lab model gateway must be a credential-free loopback HTTP URL');
  const publicUrl = env.HARNESS_LAB_PUBLIC_URL;
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('HARNESS_LAB_PUBLIC_URL must be an HTTPS origin without credentials, query, or path prefix');
  }
  const port = Number(env.HARNESS_LAB_PORT ?? 18440);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid HARNESS_LAB_PORT');
  return {
    home, modules, port, publicUrl, gatewayUrl: gateway.href.replace(/\/$/, ''),
    credentialsDirectory: env.CREDENTIALS_DIRECTORY ? absolute(env.CREDENTIALS_DIRECTORY, 'CREDENTIALS_DIRECTORY') : undefined,
    workspace: absolute(env.HARNESS_LAB_WORKSPACE ?? path.join(home, 'workspace'), 'HARNESS_LAB_WORKSPACE'),
    keyFile: absolute(env.HARNESS_LAB_GATEWAY_KEY_FILE, 'HARNESS_LAB_GATEWAY_KEY_FILE'),
    connectorsFile: absolute(env.HARNESS_LAB_CONNECTORS_FILE, 'HARNESS_LAB_CONNECTORS_FILE'),
    mcpState: absolute(env.HARNESS_LAB_MCP_STATE_DIR ?? path.join(home, 'mcp-state'), 'HARNESS_LAB_MCP_STATE_DIR'),
    mcpPython: absolute(env.HARNESS_LAB_MCP_PYTHON ?? '/usr/bin/python3', 'HARNESS_LAB_MCP_PYTHON'),
    mcpServer: absolute(env.HARNESS_LAB_MCP_SERVER ?? fileURLToPath(new URL('../mcp/server.py', import.meta.url)), 'HARNESS_LAB_MCP_SERVER'),
    fastModel: env.HARNESS_LAB_FAST_MODEL ?? 'deepseek-flash', deepModel: env.HARNESS_LAB_DEEP_MODEL ?? 'deepseek-v4-pro',
  };
}

export function prepare(options) {
  const resolver = assertRuntime(options.modules);
  privateFile(options.keyFile, 'Gateway virtual credential');
  privateFile(options.connectorsFile, 'MCP connector configuration');
  if (!fs.statSync(options.mcpServer).isFile()) throw new Error('MCP server entry is missing');
  const profile = buildProfile(options);
  for (const directory of [options.home, profile.profileDirectory, options.workspace, options.mcpState, path.join(options.home, 'private')]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = path.join(options.home, '.native-lab-home');
  if (!fs.existsSync(marker)) {
    if (fs.existsSync(path.join(options.home, '.credentials.yaml')) || fs.existsSync(path.join(options.home, 'sessions'))) throw new Error('Refusing to adopt an existing non-lab Harness home');
    atomicWrite(marker, 'harness-native-lab/v1\n');
  }
  atomicWrite(path.join(profile.profileDirectory, 'package.json'), `${JSON.stringify(profile.manifest, null, 2)}\n`);
  // JSON is YAML 1.2. This contains paths, public settings and no credential values.
  atomicWrite(path.join(profile.profileDirectory, 'cordis.patch.yml'), `${JSON.stringify(profile.patch, null, 2)}\n`);
  const cli = path.join(path.dirname(resolver.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
  return { cli, profile };
}

export async function launch(options) {
  const { cli } = prepare(options);
  const key = fs.readFileSync(options.keyFile, 'utf8').trim();
  if (!key || /\s/.test(key) || key.length > 4096) throw new Error('Invalid gateway virtual credential');
  const entryFile = path.join(options.home, 'private', 'entry-url.txt');
  fs.rmSync(entryFile, { force: true });
  const args = [cli, '--profile', PROFILE_NAME, '--host', '127.0.0.1', '--port', String(options.port), '--no-open'];
  if (options.publicUrl) args.push('--public-url', options.publicUrl, '--trusted-host', new URL(options.publicUrl).host);
  const childEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8', TZ: 'UTC',
    DSH_HOME: options.home,
    HARNESS_NODE_MODULES: options.modules, DEEPSEEK_API_KEY: key,
  };
  const child = spawn(process.execPath, args, { cwd: options.workspace, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = options.publicUrl ? new URL(options.publicUrl).origin : `http://127.0.0.1:${options.port}`;
  const line = (value, stream) => {
    const clean = value.replace(/\u001b\[[0-9;]*m/g, '');
    for (const candidate of clean.match(/https?:\/\/[^\s]+/g) ?? []) {
      try {
        const url = new URL(candidate);
        if (url.origin === origin && url.pathname === '/' && url.searchParams.has('token')) atomicWrite(entryFile, `${url.href}\n`);
      } catch { /* Diagnostic prose is not a URL. */ }
    }
    stream.write(`${value.replace(/([?&]token=)[A-Za-z0-9._~%-]+/g, '$1[redacted]')}\n`);
  };
  const out = createInterface({ input: child.stdout }); out.on('line', value => line(value, process.stdout));
  const err = createInterface({ input: child.stderr }); err.on('line', value => line(value, process.stderr));
  const terminate = signal => { if (child.exitCode === null) child.kill(signal); };
  const sigterm = () => terminate('SIGTERM');
  const sigint = () => terminate('SIGINT');
  process.on('SIGTERM', sigterm); process.on('SIGINT', sigint);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.off('SIGTERM', sigterm); process.off('SIGINT', sigint);
      out.close(); err.close();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = optionsFromEnvironment();
    if (process.argv.includes('--prepare-only')) {
      prepare(options);
      console.log('Native lab profile prepared; no service or model request started.');
    } else process.exitCode = await launch(options);
  } catch (error) {
    console.error(`Native lab: ${error.message}`);
    process.exitCode = 1;
  }
}
