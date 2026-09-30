import test from 'node:test';
import assert from 'node:assert/strict';
import { meetItems, parseMeet, collectMileSplit } from '../src/milesplit.mjs';
const school = { name: 'Corinth', milesplitId: '7669', mascot: 'Warriors' };
const source = { school: 'Corinth', key: 'ms-corinth-cc', season: 'cc', sport: 'Cross Country' };
const item = { meetId: '720537', name: 'Gatorade XC Classic', link: 'https://ms.milesplit.com/meets/720537' };
const fixture = { _embedded: { team: { id: '7669', county: 'Alcorn' }, filters: { season: { selectedValue: 'cc' }, year: { selectedValue: '2026' } } }, data: { monthGroups: [{ items: [item, { ...item, meetId: '2', name: 'MHSAA Middle School Cross Country Classic' }, { ...item, meetId: '3', name: 'JV Championship' }] }] } };
test('MileSplit checks school/season and excludes middle school and JV-only meets', () => {
  assert.deepEqual(meetItems(fixture, school, 'cc', 2026), [item]);
  assert.throws(() => meetItems(fixture, { ...school, milesplitId: '8517' }, 'cc', 2026));
});
test('uses authoritative meet date without inventing boys/girls race times', () => {
  const metadata = { '@type': 'SportsEvent', name: item.name, startDate: '2026-10-03', endDate: '2026-10-03', location: { name: 'Oakville', address: { addressLocality: 'Moulton', addressRegion: 'AL' } }, url: 'https://al.milesplit.com/meets/720537/info' };
  const html = `<script type="application/ld+json">${JSON.stringify(metadata)}</script>`;
  const e = parseMeet(html, item, source, school); assert.equal(e.date, '2026-10-03'); assert.equal(e.time, null); assert.equal(e.gender, 'Boys & Girls'); assert.equal(e.location, 'Oakville, Moulton, AL');
  assert.throws(() => parseMeet('<h1>Unavailable</h1>', item, source, school));
  const malformed = html.replace('Gatorade XC Classic', 'Gatorade\tXC\nClassic');
  assert.equal(parseMeet(malformed, item, source, school).date, '2026-10-03');
});
test('MileSplit source failure retains the prior school/season snapshot', async () => {
  const old = { school: 'Corinth', events: [{ id: 'existing' }], lastSuccess: '2026-09-29' };
  const result = await collectMileSplit({ schools: [school] }, async () => { throw new Error('HTTP 503'); }, { 'milesplit:7669:cc:2026': old }, new Date('2026-09-30'));
  assert.deepEqual(result.sources['milesplit:7669:cc:2026'].events, old.events); assert.equal(result.issues.length, 3);
});
