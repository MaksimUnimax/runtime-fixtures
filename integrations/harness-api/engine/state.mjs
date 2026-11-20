import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PipelineError } from './provider.mjs';

export function identity(value, label = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new PipelineError('INVALID_ID', `Некорректный ${label}.`);
  }
  return value;
}

export function owner(input) {
  return { actor_id: identity(input.actor_id, 'actor_id'), tenant_id: identity(input.tenant_id, 'tenant_id') };
}

export function jobKey(scope, requestId) {
  return crypto.createHash('sha256').update(JSON.stringify([scope.actor_id, scope.tenant_id, requestId])).digest('hex');
}

export function fingerprint(chatId, text) {
  return crypto.createHash('sha256').update(JSON.stringify([chatId, text])).digest('hex');
}

export class StateStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.file = path.join(this.directory, 'state.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.data.version !== 1 || !this.data.chats || !this.data.jobs) throw new Error('Invalid state version');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { version: 1, chats: {}, jobs: {} };
    }
  }

  save() {
    const temp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.data)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
    const dir = fs.openSync(this.directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }

  chat(scope, chatId) {
    identity(chatId, 'chat_id');
    const chat = this.data.chats[chatId];
    if (!chat || chat.actor_id !== scope.actor_id || chat.tenant_id !== scope.tenant_id) {
      throw new PipelineError('CHAT_NOT_FOUND', 'Разговор не найден.', 404);
    }
    return chat;
  }

  interruptedJobs() {
    let count = 0;
    for (const job of Object.values(this.data.jobs)) {
      if (!job.finished) {
        job.finished = true;
        job.state = 'interrupted';
        job.error = { code: 'PROCESS_RESTARTED', message: 'Работа была прервана перезапуском сервиса. Запрос автоматически не повторялся.' };
        count++;
      }
    }
    if (count) this.save();
    return count;
  }
}
