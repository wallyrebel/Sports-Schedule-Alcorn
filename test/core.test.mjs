import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, parseSchedule, parseContest, deduplicate, toICS, centralDate } from '../src/core.mjs';
const source = { key: 'corinth-bb', school: 'Corinth', schoolId: 'corinth', gender: 'Boys', sport: 'Basketball', year: '26-27', url: 'https://www.maxpreps.com/ms/corinth/corinth-warriors/basketball/schedule/' };
const team = (id, name, home) => { const t = []; t[1] = id; t[11] = home; t[14] = name; t[15] = name; t[16] = 'MS'; return t; };
function contest(id = 'game1', time = '2026-11-12T19:30:00') {
  const c = []; c[0] = [team('corinth', 'Corinth', 0), team('kossuth', 'Kossuth', 1)]; c[1] = id; c[2] = '2026-09-30T10:00:00'; c[3] = false; c[11] = time; c[28] = 'ContestState is Pregame.'; return c;
}
const html = props => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script>`;
test('only current boys and girls varsity sports are discovered, including the next school year', () => {
  const base = { schoolId: 'corinth', isPublished: true, level: 'Varsity', gender: 'Boys', sport: 'Basketball', season: 'Winter', year: '26-27', canonicalUrl: source.url };
  const seasons = [base, { ...base, gender: 'Girls' }, { ...base, gender: 'Co-ed' }, { ...base, level: 'JV' }, { ...base, year: '13-14' }, { ...base, year: '27-28' }];
  assert.equal(discover(html({ schoolContext: { sportSeasons: seasons } }), { name: 'Corinth' }, new Date('2026-09-30T15:00:00Z')).length, 3);
});
test('matchups use school identity, correct home/away, and stable contest IDs', () => {
  const c = contest(); const before = parseContest(c, source); c[11] = '2026-11-13T18:00:00'; const after = parseContest(c, source);
  assert.equal(before.title, 'Kossuth at Corinth'); assert.equal(before.id, after.id); assert.equal(after.time, '18:00');
  assert.throws(() => parseContest(c, { ...source, schoolId: 'wrong' }), /expected school/);
});
test('deleted games excluded; cancelled and postponed games are labelled', () => {
  const c = contest(); c[3] = true; assert.equal(parseContest(c, source), null); c[3] = false;
  c[28] = 'ContestState is Cancelled.'; assert.equal(parseContest(c, source).status, 'cancelled');
  c[28] = 'ContestState is Postponed.'; assert.equal(parseContest(c, source).status, 'postponed');
});
test('a county matchup appears once; separate genders and doubleheaders remain', () => {
  const e = parseContest(contest(), source);
  const other = { ...e, schools: ['Kossuth'], sourceKeys: ['kossuth-bb'] };
  const later = parseContest(contest('game2', '2026-11-12T21:00:00'), source);
  const girls = parseContest(contest('game3'), { ...source, gender: 'Girls' });
  const events = deduplicate([e, other, later, girls], ['Corinth', 'Kossuth']);
  assert.equal(events.length, 3); assert.deepEqual(events.find(x => x.id === e.id).schools.sort(), ['Corinth', 'Kossuth']);
});
test('unrecognized pages and wrong team/gender/year cannot erase the prior schedule', () => {
  assert.throws(() => parseSchedule('<h1>Temporarily unavailable</h1>', source));
  const context = { level: 'Varsity', gender: 'Boys', sport: 'Basketball', teamId: 'corinth', year: '26-27' };
  assert.equal(parseSchedule(html({ teamContext: { data: context }, contests: [contest()] }), source).events.length, 1);
  assert.throws(() => parseSchedule(html({ teamContext: { data: { ...context, gender: 'Girls' } }, contests: [] }), source));
  assert.deepEqual(parseSchedule('<p>No Schedule Available</p>', source).events, []);
});
test('Central dates are correct near UTC midnight and calendar uses DST-aware local times', () => {
  assert.equal(centralDate(new Date('2026-10-01T02:00:00Z')), '2026-09-30');
  const e = parseContest(contest(), source); const ics = toICS([e]);
  assert.match(ics, /TZID:America\/Chicago/); assert.match(ics, /DTSTART;TZID=America\/Chicago:20261112T193000/);
  assert.match(ics, /TZOFFSETTO:-0600/); assert.match(ics, /TZOFFSETTO:-0500/);
  const uid = text => text.match(/UID:([^\r]+)/)[1]; assert.equal(uid(ics), uid(toICS([{ ...e, time: '18:00' }])));
});
test('unknown time becomes a date-only event, never a midnight game', () => {
  const e = parseContest(contest('tbd', '2026-11-12T00:00:00'), source);
  assert.equal(e.time, null); assert.match(toICS([e]), /DTSTART;VALUE=DATE:20261112/); assert.match(toICS([e]), /time TBD/);
});
test('ICS escapes injected lines and folds long Unicode lines by octets', () => {
  const e = { ...parseContest(contest(), source), title: '🏈'.repeat(50) + '\nBEGIN:VEVENT,;' };
  const ics = toICS([e]); assert.equal(ics.split('\r\nBEGIN:VEVENT').length, 2);
  assert(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});
