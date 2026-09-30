import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { centralDate, discover, parseSchedule, deduplicate, toICS } from './core.mjs';
import { collectMileSplit } from './milesplit.mjs';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const output = new URL('../docs/', import.meta.url);
await mkdir(output, { recursive: true });
const now = new Date();
const today = centralDate(now);
const cutoff = centralDate(new Date(now.getTime() - 14 * 86400000));
let previous = { sources: {}, events: [], cancellations: [] };
try { previous = JSON.parse(await readFile(new URL('state.json', output), 'utf8')); }
catch (err) { if (err.code !== 'ENOENT') throw err; }
const sources = {}; const issues = []; let successful = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(url) {
  if (new URL(url).hostname !== 'www.maxpreps.com' && !/^(?:[a-z]{2,3}\.)?milesplit\.com$/.test(new URL(url).hostname)) throw new Error('Unexpected source host');
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt ? 3000 * attempt : 1100);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlcornSportsSchedule/1.0; +https://alcornsportsms.com/schedule/)', 'Accept': 'text/html' } });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      return await response.text();
    } catch (err) { error = err; }
  }
  throw error;
}
for (const school of config.schools) {
  console.log(`Discovering ${school.name}`);
  let discovered;
  try {
    discovered = discover(await get(school.url), school, now);
    if (!discovered.length) throw new Error('No current varsity sports discovered');
  } catch (err) {
    issues.push(`${school.name}: ${err.message}`);
    for (const [key, value] of Object.entries(previous.sources).filter(([, s]) => s.school === school.name && s.provider !== 'MileSplit')) sources[key] = { ...value, error: err.message };
    continue;
  }
  for (const source of discovered) {
    console.log(`  ${source.gender} ${source.sport} (${source.year})`);
    try {
      const parsed = parseSchedule(await get(source.url), source);
      sources[source.key] = { ...source, ...parsed, lastSuccess: now.toISOString(), error: null };
      successful++;
    } catch (err) {
      sources[source.key] = { ...source, ...(previous.sources[source.key] || { events: [] }), error: err.message };
      issues.push(`${source.school} ${source.gender} ${source.sport}: ${err.message}`);
    }
  }
}
const milesplit = await collectMileSplit(config, get, previous.sources, now);
Object.assign(sources, milesplit.sources); issues.push(...milesplit.issues); successful += milesplit.successful;
if (!successful) throw new Error('All sources failed. Published calendar left unchanged.');
const events = deduplicate(Object.values(sources).flatMap(s => s.events).filter(e => e.date >= cutoff), config.schools.map(s => s.name));
const signature = e => JSON.stringify([e.date, e.time, e.title, e.location, e.status]);
for (const e of events) {
  const old = previous.events.find(x => x.id === e.id);
  e.sequence = (old?.sequence || 0) + (old && signature(old) !== signature(e) ? 1 : 0);
}
const cancellations = [...(previous.cancellations || []).filter(e => e.date >= cutoff && !events.some(x => x.id === e.id))];
for (const e of previous.events) {
  if (e.date < cutoff || events.some(x => x.id === e.id)) continue;
  if (!cancellations.some(x => x.id === e.id)) cancellations.push({ ...e, status: 'cancelled', sequence: (e.sequence || 0) + 1 });
}
const coverage = Object.values(sources).map(({ events: list, ...s }) => ({ ...s, upcoming: list.filter(e => e.date >= today && e.status !== 'cancelled').length }));
const publicData = { name: config.name, timezone: config.timezone, lastChecked: now.toISOString(), lastCompleteUpdate: issues.length ? previous.lastCompleteUpdate || null : now.toISOString(), schools: config.schools, events, coverage, issues };
await writeFile(new URL('schedule.json', output), JSON.stringify(publicData, null, 2) + '\n');
await writeFile(new URL('schedule.ics', output), toICS([...events, ...cancellations], now));
await writeFile(new URL('state.json', output), JSON.stringify({ sources, events, cancellations, lastCompleteUpdate: publicData.lastCompleteUpdate }, null, 2) + '\n');
console.log(JSON.stringify({ events: events.length, upcoming: events.filter(e => e.date >= today).length, sources: coverage.length, successful, issues }, null, 2));
if (issues.length) process.exitCode = 2; // Workflow publishes good data, then reports the partial failure.
