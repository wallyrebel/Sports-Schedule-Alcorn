import { createHash } from 'node:crypto';

export function centralDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function nextData(html) {
  const match = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  return match ? JSON.parse(match[1]).props?.pageProps : null;
}

export function discover(html, school, now = new Date()) {
  const seasons = nextData(html)?.schoolContext?.sportSeasons;
  if (!Array.isArray(seasons) || !seasons.length) throw new Error('School sports data missing; refusing an empty replacement.');
  const today = centralDate(now);
  const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 7 ? 1 : 0);
  const varsity = seasons.filter(s => s.level === 'Varsity' && s.isPublished && ['Boys', 'Girls'].includes(s.gender));
  const current = varsity.filter(s => Number(s.year?.split('-')[0]) + 2000 >= year && Number(s.year?.split('-')[0]) + 2000 <= year + 1);
  return current.map(s => ({
    school: school.name, schoolId: s.schoolId, sport: s.sport, gender: s.gender, year: s.year,
    key: `${s.schoolId}:${s.gender}:${s.sport}:${s.season}:${s.year}`,
    url: s.canonicalUrl.includes('/schedule') ? s.canonicalUrl : s.canonicalUrl.replace(/\/$/, '') + '/schedule/'
  })).filter((s, i, all) => all.findIndex(x => x.key === s.key) === i);
}

export function safeSource(url, fallback) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'www.maxpreps.com') return parsed.href;
  } catch {}
  return fallback;
}

export function parseContest(c, source) {
  if (!Array.isArray(c) || !Array.isArray(c[0]) || !c[1]) throw new Error('Unrecognized contest schema');
  const state = String(c[28] || '');
  if (/deleted/i.test(state) || c[3] === true) return null;
  const teams = c[0].filter(Array.isArray);
  if (!teams.some(t => t[1] === source.schoolId)) throw new Error('Contest does not contain the expected school');
  if (teams.length !== 2) throw new Error('Unsupported contest participants');
  const dateTime = c[11];
  if (typeof dateTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateTime) || !Number.isFinite(Date.parse(dateTime + 'Z'))) {
    throw new Error('Unsupported source date/time');
  }
  const neutral = teams.some(t => t[11] === 2);
  const home = teams.find(t => t[11] === 0);
  const away = teams.find(t => t !== home);
  const ordered = home && away && !neutral ? [away, home] : teams;
  const participants = ordered.map(t => ({ id: t[1], name: t[14] || 'Opponent TBD', mascot: t[21] || '' }));
  const timeTbd = dateTime.slice(11) === '00:00:00';
  return {
    id: `${source.gender}:${source.sport}:${c[1]}`,
    contestId: c[1], updated: c[2] || '', date: dateTime.slice(0, 10),
    time: timeTbd ? null : dateTime.slice(11, 16),
    sport: source.sport, gender: source.gender, level: 'Varsity', participants,
    title: participants.map(p => p.name).join(neutral || !home ? ' vs. ' : ' at '),
    location: neutral ? 'Neutral site — see source' : home ? `${home[14]}${home[15] ? ', ' + home[15] : ''}${home[16] ? ', ' + home[16] : ''}` : 'Location TBD',
    status: /cancel/i.test(state) ? 'cancelled' : /postpon/i.test(state) ? 'postponed' : 'scheduled',
    sourceUrl: safeSource(c[18], source.url), sourceKeys: [source.key], schools: [source.school]
  };
}

export function parseSchedule(html, source) {
  const data = nextData(html);
  if (!data) {
    // MaxPreps still serves older HTML for some individual sports. Only accept
    // its explicit empty state; unknown layouts must not erase stored games.
    const visible = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
    if (/No Schedule Available/i.test(visible)) return { events: [], note: 'No schedule published on MaxPreps' };
    throw new Error('Schedule format unavailable; previous events retained');
  }
  const context = data.teamContext?.data;
  if (!context || context.level !== 'Varsity' || context.gender !== source.gender || context.sport !== source.sport || context.teamId !== source.schoolId || context.year !== source.year) {
    throw new Error('Schedule identity/year mismatch; previous events retained');
  }
  if (!Array.isArray(data.contests)) throw new Error('Contest list missing; previous events retained');
  return { events: data.contests.map(c => parseContest(c, source)).filter(Boolean), note: data.contests.length ? '' : 'No schedule published on MaxPreps' };
}

export function deduplicate(events, schoolNames = []) {
  const map = new Map();
  // A contest can appear on both schools' pages. Prefer the newest source edit.
  for (const event of [...events].sort((a, b) => a.updated.localeCompare(b.updated))) {
    const old = map.get(event.id);
    const participants = [...new Map([...(old?.participants || []), ...event.participants].map(p => [p.id, p])).values()];
    map.set(event.id, { ...event, participants, sourceKeys: [...new Set([...(old?.sourceKeys || []), ...event.sourceKeys])], schools: [...new Set([...(old?.schools || []), ...event.schools, ...event.participants.map(p => p.name).filter(n => schoolNames.includes(n))])] });
  }
  // Occasionally the source creates two IDs for the same exact matchup.
  // Include time to preserve genuine doubleheaders and gender to preserve both teams.
  const matchups = new Map();
  for (const event of map.values()) {
    const key = [event.gender, event.sport, event.date, event.time, ...event.participants.map(p => p.id || p.name).sort()].join('|');
    const old = matchups.get(key);
    if (!old) matchups.set(key, event);
    else matchups.set(key, { ...event, id: [old.id, event.id].sort()[0], schools: [...new Set([...old.schools, ...event.schools])], sourceKeys: [...new Set([...old.sourceKeys, ...event.sourceKeys])] });
  }
  return [...matchups.values()].sort((a, b) => `${a.date}T${a.time || '23:59'}`.localeCompare(`${b.date}T${b.time || '23:59'}`) || a.title.localeCompare(b.title));
}

const escapeICS = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line) {
  const parts = []; let part = '';
  for (const char of line) {
    if (Buffer.byteLength(part + char) > 73) { parts.push(part); part = ' '; }
    part += char;
  }
  parts.push(part); return parts.join('\r\n');
}
export function toICS(events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alcorn County Sports//Varsity Schedule//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Alcorn County Varsity Sports', 'X-WR-TIMEZONE:America/Chicago', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', 'TZID:America/Chicago', 'BEGIN:DAYLIGHT', 'DTSTART:19700308T020000', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const e of events) {
    const uid = createHash('sha256').update(e.id).digest('hex').slice(0, 32);
    lines.push('BEGIN:VEVENT', `UID:${uid}@alcornsportsms.com`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `SEQUENCE:${e.sequence || 0}`,
      e.time ? `DTSTART;TZID=America/Chicago:${e.date.replaceAll('-', '')}T${e.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${e.date.replaceAll('-', '')}`,
      `SUMMARY:${escapeICS(`${e.status === 'scheduled' ? '' : e.status.toUpperCase() + ': '}${e.gender} ${e.sport}: ${e.title}${e.time ? '' : ' (time TBD)'}`)}`,
      `DESCRIPTION:${escapeICS(`Varsity. All times Central. ${e.note || ''} ${e.time ? '' : 'Time TBD — check source. '}${e.status === 'postponed' ? 'Postponed — check source for a new date. ' : ''}Schedule subject to change. Source: ${e.sourceUrl}`)}`,
      `LOCATION:${escapeICS(e.location)}`, `URL:${e.sourceUrl}`, `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : e.status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
