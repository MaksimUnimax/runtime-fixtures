// Prices in trillionths of a coin; binding a rate version to each attempt makes replay deterministic.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export const rateVersion = 'deepseek-2026-11-18';
export const rates = Object.freeze({
  'deepseek-flash': { input: 0.30, cache: 0.006, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, cache: 0.044, output: 3.96 },
});
const contextWindow = 1048576;

// This release covers the published tariff through the reviewed public holiday calendar.
// 2027 dates: State Council notice issued Nov 5, 2026. The UTC peak windows are also
// on the same calendar date in Beijing. Weekend make-up workdays are still off-peak.
const holidays2027 = [[101,103],[205,213],[403,405],[501,505],[609,609],[915,915],[1001,1007]];
export function period(ms) {
  const date = new Date(ms), day = date.getUTCDay(), hour = date.getUTCHours();
  if (!Number.isFinite(ms) || ms < Date.UTC(2026, 10, 18, 4) || ms >= Date.UTC(2028, 0, 1)) return null;
  const monthDay = (date.getUTCMonth()+1)*100 + date.getUTCDate();
  if (date.getUTCFullYear() === 2027 && holidays2027.some(([a,b]) => a <= monthDay && monthDay <= b)) return 'offpeak';
  return day > 0 && day < 6 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)) ? 'peak' : 'offpeak';
}

function price(model, input, cached, output, band, markup, conversion, fx) {
  const r = rates[model];
  const weighted = [[r.input, input], [r.cache, cached], [r.output, output]]
    .reduce((sum, [rate, count]) => sum + BigInt(Math.round(rate * 1e6)) * BigInt(count), 0n);
  if (fx) {
    const divisor = band === 'peak' ? 10000n : 20000n;
    return (weighted * fx + divisor - 1n) / divisor;
  }
  return weighted * BigInt(conversion) * (100n + BigInt(markup)) / (band === 'peak' ? 100n : 200n);
}

export function coinBilling(db) {
  function statement(sql) {
    const query = db.prepare(sql);
    query.setReadBigInts(true);
    return query;
  }
  const order = statement(`SELECT o.*,r.fx_e4 FROM coin_orders o
    LEFT JOIN coin_ruble_orders r USING(operation_id) WHERE operation_id=?`);
  const wallet = statement('SELECT available FROM coin_wallet_balances WHERE workspace_id=?');
  const allocated = statement('SELECT COALESCE(SUM(COALESCE(charge,bound)),0) AS used FROM coin_attempts WHERE operation_id=?');
  const lookup = statement(`SELECT a.*,o.coins_per_usd,o.markup,r.fx_e4 FROM coin_attempts a
    JOIN coin_orders o USING(operation_id) LEFT JOIN coin_ruble_orders r USING(operation_id) WHERE attempt_id=?`);
  const insert = db.prepare(`INSERT INTO coin_attempts(attempt_id,operation_id,bound,model,started_ms,rate_version,period)
    VALUES(?,?,?,?,?,?,?)`);
  const finish = db.prepare(`UPDATE coin_attempts SET charge=?,provider_id=?,usage_json=?,evidence=?
    WHERE attempt_id=? AND charge IS NULL`);

  function reserve(entry, authorized, bytes, toolCount = 0) {
    const band = period(entry.started_ms);
    if (!band) throw new Error('Missing reviewed DeepSeek rate calendar');
    const id = entry.attribution.operation_id;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!authorized()) { db.exec('ROLLBACK'); return false; }
      const contract = order.get(id);
      if (!contract || contract.closed) { db.exec('ROLLBACK'); return false; }
      // Text-only requests. Count serialized UTF-8 bytes plus framing overhead
      // for system, history and tools. Unknown payloads use the full context bound.
      const input = contract.fx_e4 && Number.isSafeInteger(bytes)
        ? Math.min(contextWindow, bytes + 1024 + 32 * ((entry.messages || 0) + toolCount)) : contextWindow;
      const cost = (output) => price(entry.model, input, 0, output, 'peak',
        contract.markup, contract.coins_per_usd, contract.fx_e4);
      let available = contract.cap - allocated.get(id).used;
      if (contract.fx_e4) {
        const funds = wallet.get(contract.workspace_id).available;
        if (funds < available) available = funds;
        entry.billing_fx_rub_per_usd = Number(contract.fx_e4) / 10000;
        // A small balance can still fund a shorter completion.
        if (cost(entry.max_tokens) > available && available >= cost(1)) {
          let low = 1, high = entry.max_tokens;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (cost(mid) <= available) low = mid;
            else high = mid - 1;
          }
          entry.max_tokens = low;
        }
      }
      const bound = cost(entry.max_tokens);
      if (bound > available) {
        db.prepare('UPDATE coin_orders SET budget_hit=1 WHERE operation_id=?').run(id);
        db.exec('COMMIT');
        return false;
      }
      insert.run(entry.attempt_id, id, bound, entry.model, entry.started_ms, rateVersion, band);
      db.exec('COMMIT');
      return true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function settle(event) {
    const row = lookup.get(event.attempt_id);
    if (!row || row.charge !== null || row.rate_version !== rateVersion ||
        row.operation_id !== event.attribution?.operation_id) return;
    const counts = event.usage;
    let charge;
    if (event.outcome === 'client_disconnected_before_dispatch' || event.outcome === 'not_dispatched') {
      charge = 0n;
    } else {
      const valid = counts && ['input_tokens','cache_read_input_tokens','output_tokens','cache_creation_input_tokens']
        .every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
      // The gateway only populates usage after terminal provider usage was observed.
      if (!(event.status >= 200 && event.status < 300) || !valid || counts.cache_creation_input_tokens !== 0 ||
          (event.response_model && event.response_model !== row.model)) return;
      // A call crossing a price boundary needs provider evidence to select the billed period.
      if (period(Date.parse(event.finished_at)) !== row.period) return;
      charge = price(row.model, counts.input_tokens, counts.cache_read_input_tokens, counts.output_tokens,
                     row.period, row.markup, row.coins_per_usd, row.fx_e4);
      if (charge > row.bound) return;
    }
    finish.run(charge, event.provider_response_id ?? null, JSON.stringify(counts ?? null), event.outcome, event.attempt_id);
  }
  async function recover(logFile) {
    if (!db.prepare('SELECT 1 FROM coin_attempts WHERE charge IS NULL LIMIT 1').get()) return;
    try {
      const lines = createInterface({ input: createReadStream(logFile), crlfDelay: Infinity });
      for await (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.event === 'finished' && event.attribution) settle(event);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { reserve, settle, recover };
}
