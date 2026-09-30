import { readFile } from 'node:fs/promises';
const expected = JSON.parse(await readFile('docs/schedule.json', 'utf8'));
const url = 'https://alcornsportsms.com/wp-json/alcorn-sports/v1/schedule';
// Public GET triggers only a throttled fetch of the fixed repository feed; no WP credentials needed.
// Raw GitHub/CDN caches can take several minutes to publish the latest commit.
let matched = false;
for (let attempt = 0; attempt < 8; attempt++) {
  if (attempt) await new Promise(resolve => setTimeout(resolve, 60000));
  try {
    const response = await fetch(url + '?check=' + Date.now(), { signal: AbortSignal.timeout(120000), headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`WordPress HTTP ${response.status}`);
    const data = await response.json();
    if (data.syncError) throw new Error(data.syncError);
    if (data.lastChecked >= expected.lastChecked && data.events.every(e => e.eventUrl?.startsWith('https://alcornsportsms.com/'))) {
      console.log(`WordPress synced ${data.events.length} events; source checked ${data.lastChecked}`); matched = true; break;
    }
    console.log(`Waiting for feed propagation (${data.lastChecked})`);
  } catch (err) { console.log(err.message); }
}
if (!matched) throw new Error('WordPress did not confirm the new feed. Check Events → Alcorn Schedule Sync.');
