// Disposable operation-scoped gateway in front of the operator's existing model gateway.
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createGateway } from '../../../../../integrations/harness-native-lab/gateway/server.mjs';
import { openOperationResolver } from '../../../../../integrations/harness-native-lab/gateway/operation-resolver.mjs';

const [database, journal] = process.argv.slice(2);
const upstream = new URL(process.env.HARNESS_ACCEPTANCE_GATEWAY);
if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' ||
    upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') {
  throw new Error('Expected a loopback operator gateway');
}
const resolver = openOperationResolver(database);
const gateway = createGateway({
  resolveAttribution: resolver.resolve,
  upstreamBase: upstream.origin,
  realKey: (await readFile(process.env.HARNESS_ACCEPTANCE_KEY_FILE, 'utf8')).trim(),
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
