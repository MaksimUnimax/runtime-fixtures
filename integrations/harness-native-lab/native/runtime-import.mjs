import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const HARNESS_VERSION = '0.2.2-rc.1';

export function runtimeResolver(directory = process.env.HARNESS_NODE_MODULES) {
  if (!directory || !path.isAbsolute(directory)) throw new Error('HARNESS_NODE_MODULES must be an absolute installed runtime node_modules directory');
  return createRequire(path.join(directory, '__harness_native_lab__.cjs'));
}

export function assertRuntime(directory) {
  const resolver = runtimeResolver(directory);
  const pkg = JSON.parse(fs.readFileSync(resolver.resolve('@deepseek-ai/dsh/package.json'), 'utf8'));
  if (pkg.version !== HARNESS_VERSION) throw new Error(`Native lab requires Harness ${HARNESS_VERSION}; found ${pkg.version}`);
  return resolver;
}

export async function importRuntime(name, directory) {
  const resolver = runtimeResolver(directory);
  return import(pathToFileURL(resolver.resolve(name)).href);
}
