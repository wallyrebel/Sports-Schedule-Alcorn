import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';

const clean = node => node?.text?.replace(/\s+/g, ' ').trim() || '';
const yearAt = (value, month) => Number('20' + value.split('-')[month < 7 ? 1 : 0]);
const participant = name => ({ id: name.toLowerCase(), name, mascot: '' });

// Bowling uses the older MaxPreps table, including multi-school meets that
// have no contest UUID until results are posted.
export function bowlingSchedule(html, source, schools) {
  const page = parse(html);
  const target = JSON.parse(page.querySelector('meta[name=targeting]')?.getAttribute('content') || '{}');
  const season = clean(page.querySelector('dd[id$=_Team]'));
  const first = '20' + source.year.slice(0, 2), last = '20' + source.year.slice(-2);
  if (target.mpschoolid !== source.schoolId || target.gnd !== source.gender.toLowerCase() ||
      target.activity !== 'bowling' || target.state !== 'ms' ||
      ![`Varsity ${first}-${last.slice(-2)}`, `Varsity ${last}`].includes(season)) {
    throw new Error('Bowling schedule identity/year mismatch; previous events retained');
  }
  const rows = page.querySelectorAll('table#schedule tbody tr');
  if (!rows.length) throw new Error('Bowling schedule table missing or empty');
  const events = rows.map(row => {
    const dayText = clean(row.querySelector('.event-date'));
    const md = dayText.match(/^(\d{1,2})\/(\d{1,2})$/);
    const label = clean(row.querySelector('.contest-name'));
    if (!md || !label) throw new Error('Bowling row missing a date or contest name');
    const date = [yearAt(source.year, Number(md[1])), md[1].padStart(2,'0'), md[2].padStart(2,'0')].join('-');
    const stamp = new Date(date+'T12:00:00Z');
    if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0,10) !== date) throw new Error('Invalid bowling date');
    const detail = clean(row.querySelector('.contest-details')).replace(/^Game Details:\s*/i,'');
    const venue = clean(row.querySelector('.contest-location')).replace(/^Location:\s*/i,'') ||
      (/\b(lanes|bowling cent(?:er|re))\b/i.test(detail) ? detail : '');
    let names = [source.school], title, meetName = '';
    if (row.classList.contains('multi-team-contest')) {
      const teams = label.split(/\s+vs\.?\s+/i);
      if (teams.length > 1 && teams.includes(source.school)) names = teams;
      else meetName = label;
      title = meetName ? `${source.school} at ${meetName}` : teams.join(' vs. ');
    } else if (row.classList.contains('dual-contest')) {
      const opponent = label.replace(/^@\s*/, '').replace(/\s*\([^()]*\)$/, '').trim();
      if (!opponent) throw new Error('Bowling opponent field missing');
      const conflictingTeam = schools.some(s => s.name !== source.school && s.name !== opponent &&
        (detail === s.name || detail === s.name+' '+s.mascot));
      const namedMeet = /\b(regional|regionals|tournament|championship|championships)\b/i.test(detail);
      if (conflictingTeam || namedMeet) {
        meetName = detail;
        title = namedMeet ? `${source.school} at ${detail}` : `${source.school} bowling meet (opponent unconfirmed)`;
      } else {
        names.push(opponent);
        title = label.startsWith('@') ? `${source.school} at ${opponent}` : `${source.school} vs. ${opponent}`;
      }
    } else throw new Error('Unsupported bowling event row');
    // The table displays a clock time but does not specify its time zone.
    // Retain it only to distinguish two same-day listings.
    const listedSlot = clean(row.querySelector('.event-time'));
    const matchupHint = [meetName.toLowerCase(), listedSlot.toLowerCase()].join('|');
    const signature = [source.gender,date,...names.map(s=>s.toLowerCase()).sort(),matchupHint].join('|');
    const id = 'bowling-'+createHash('sha256').update(signature).digest('hex').slice(0,24);
    const result = clean(row.querySelector('.result'));
    return {id, contestId:row.querySelector('[data-contest-id]')?.getAttribute('data-contest-id') || id,
      date,time:null,updated:'',sport:'Bowling',gender:source.gender,level:'Varsity',title,
      participants:names.map(participant),location:venue || 'Location TBD',
      status:/cancel/i.test(result+' '+detail) ? 'cancelled' : /postpon/i.test(result+' '+detail) ? 'postponed' : 'scheduled',
      sourceUrl:source.url,sourceKeys:[source.key],schools:[source.school],matchupHint};
  });
  return {events,note:'MaxPreps bowling schedule. Confirm local start times with the school.'};
}
