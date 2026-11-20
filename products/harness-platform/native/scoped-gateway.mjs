// Meter each native model request before forwarding it to the private provider relay.
import { join } from 'node:path';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createGateway } from '../../../integrations/harness-native-lab/gateway/server.mjs';
import { openOperationResolver } from '../../../integrations/harness-native-lab/gateway/operation-resolver.mjs';

const [database, journal] = process.argv.slice(2);
const relay = process.env.HARNESS_PROVIDER_RELAY_URL ?? process.env.HARNESS_ACCEPTANCE_GATEWAY;
const upstream = relay ? new URL(relay) : null;
if (upstream && (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' ||
    upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/')) {
  throw new Error('Expected a loopback operator gateway');
}
const resolver = openOperationResolver(database);
const gateway = createGateway({
  resolveAttribution: resolver.resolve, billing: resolver.billing,
  async resolveUpstream() {
    const directory = process.env.HARNESS_PROVIDER_KEYS_DIR;
    if (directory) {
      try {
        const realKey = (await readFile(join(directory,'deepseek'),'utf8')).trim();
        if (realKey) return {realKey,upstreamBase:'https://api.deepseek.com/anthropic'};
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const file=process.env.HARNESS_PROVIDER_RELAY_KEY_FILE ?? process.env.HARNESS_ACCEPTANCE_KEY_FILE;
    return file && upstream ? {realKey:(await readFile(file,'utf8')).trim(),upstreamBase:upstream.origin} : null;
  },
  logFile: journal,
});
try {
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  console.log('http://127.0.0.1:' + gateway.server.address().port);
  for await (const _ of process.stdin) { /* The parent closes stdin after the run. */ }
} finally {
  gateway.server.close();
  gateway.server.closeAllConnections();
  await gateway.flush();
  resolver.close();
}
