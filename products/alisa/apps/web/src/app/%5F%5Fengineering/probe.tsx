'use client';
import {useState} from 'react';
export default function Probe() {
  const [id, setId] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const probe_id = id || crypto.randomUUID();
      setId(probe_id);
      let response = await fetch('/api/engineering/probes', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({probe_id, kind: 'foundation-v1'})});
      let data = await response.json(); setResult(JSON.stringify(data, null, 2));
      if (!response.ok) return;
      for (let n = 0; n < 40 && data.state !== 'PROCESSED'; n++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        response = await fetch(`/api/engineering/probes/${probe_id}`, {cache: 'no-store'});
        data = await response.json(); setResult(JSON.stringify(data, null, 2));
        if (!response.ok) return;
      }
      if (data.state !== 'PROCESSED') setResult(JSON.stringify({...data, code: 'WORKER_PENDING'}, null, 2));
    } catch {setResult('Не удалось получить результат. Повтор использует тот же ID.');}
    finally {setBusy(false);}
  }
  return <section><label>UUID пробы<input aria-label="UUID пробы" value={id} onChange={e => setId(e.target.value)} /></label><button disabled={busy} onClick={run}>{busy ? 'Проверка…' : 'Отправить пробу'}</button><pre data-testid="result" aria-live="polite">{result}</pre></section>;
}
