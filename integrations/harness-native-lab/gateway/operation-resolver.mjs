// Private gateway adapter for grants issued by the authenticated product server.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function openOperationResolver(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const { application_id } = db.prepare('PRAGMA application_id').get();
    if (application_id !== 0x48504c54) throw new Error('Expected Harness platform database');
    const byToken = db.prepare(`
      SELECT o.workspace_id, o.operation_id, o.source
        FROM usage_grants g
        JOIN usage_operations o USING (operation_id)
        JOIN workspaces w ON w.workspace_id = o.workspace_id AND w.owner_id = o.actor_id
       WHERE g.token_hash = ? AND g.expires_at > unixepoch()
         AND (o.source <> 'chat.turn' OR EXISTS (
             SELECT 1 FROM workspace_paid_model_access p WHERE p.workspace_id = o.workspace_id
         ))
         AND (o.chat_id = '' OR EXISTS (
             SELECT 1 FROM chats c WHERE c.workspace_id = o.workspace_id AND c.chat_id = o.chat_id
         ))
    `);
    return {
      resolve(token) {
        if (typeof token !== 'string' || token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token)) {
          return null;
        }
        return byToken.get(createHash('sha256').update(token).digest('hex')) ?? null;
      },
      close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
