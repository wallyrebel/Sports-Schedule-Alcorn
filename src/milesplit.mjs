// Public school schedule endpoint used by MileSplit's own team pages.
// Only meet-level information is collected; no athlete data or paid rankings.
export function meetItems(data, school, season, year) {
  if (String(data?._embedded?.team?.id) !== school.milesplitId || data?._embedded?.team?.county !== 'Alcorn' || data?._embedded?.filters?.season?.selectedValue !== season || String(data?._embedded?.filters?.year?.selectedValue) !== String(year) || !Array.isArray(data?.data?.monthGroups)) {
    throw new Error('MileSplit school/season identity or schedule format changed');
  }
  return data.data.monthGroups.flatMap(group => group.items).filter(item => {
    if (!item.meetId || typeof item.name !== 'string') throw new Error('Unrecognized MileSplit schedule item');
    return !/middle\s*school|junior\s*high|jr\.?\s*high|\bJV\b|junior\s*varsity/i.test(item.name);
  });
}

export function parseMeet(html, item, source, school) {
  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const records = blocks.flatMap(m => {
    // Some meet titles contain literal tabs/newlines in JSON-LD strings.
    // Repair only control characters inside strings; never evaluate source code.
    let quoted = false, escaped = false, json = '';
    for (const char of m[1]) {
      if (quoted && char.charCodeAt(0) < 32) { json += JSON.stringify(char).slice(1, -1); escaped = false; continue; }
      json += char;
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') escaped = true;
      else if (char === '"') quoted = !quoted;
    }
    const value = JSON.parse(json); return Array.isArray(value) ? value : value['@graph'] || [value];
  });
  const meet = records.find(x => x['@type'] === 'SportsEvent');
  if (!meet || !/^\d{4}-\d{2}-\d{2}$/.test(meet.startDate)) throw new Error('MileSplit meet date unavailable; prior meet retained');
  const title = String(meet.name || item.name).trim();
  if (/middle\s*school|junior\s*high|jr\.?\s*high|\bJV\b|junior\s*varsity/i.test(title)) return null;
  const url = new URL(meet.url || item.link);
  if (url.protocol !== 'https:' || !/^(?:[a-z]{2,3}\.)?milesplit\.com$/.test(url.hostname)) throw new Error('Unexpected meet source URL');
  const address = meet.location?.address || {};
  const cancelled = /cancel/i.test(meet.eventStatus || '') || /cancelled|canceled/i.test(title);
  const postponed = /postpon/i.test(meet.eventStatus || '') || /postponed/i.test(title);
  return {
    id: `MileSplit:${source.season}:${item.meetId}`, contestId: String(item.meetId), updated: '',
    date: meet.startDate, endDate: meet.endDate || meet.startDate, time: null,
    sport: source.sport, gender: 'Boys & Girls', level: 'Varsity',
    participants: [{ id: `milesplit:${school.milesplitId}`, name: school.name, mascot: school.mascot }],
    title, location: [meet.location?.name, address.addressLocality || item.venueCity, address.addressRegion || item.venueState].filter(Boolean).join(', '),
    status: cancelled ? 'cancelled' : postponed ? 'postponed' : 'scheduled',
    sourceUrl: url.href, sourceName: 'MileSplit', sourceKeys: [source.key], schools: [school.name],
    note: 'School-listed varsity meet. Boys/girls race assignments and start times: see meet information. Middle-school-only and JV-only meets excluded.'
  };
}

export async function collectMileSplit(config, get, previous, now) {
  const sources = {}, issues = [], meets = new Map(); let successful = 0;
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now));
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'numeric' }).format(now));
  const schoolYear = year - (month < 7 ? 1 : 0);
  for (const school of config.schools) {
    for (const season of ['cc', 'indoor', 'outdoor']) {
      const source = { school: school.name, schoolId: `milesplit:${school.milesplitId}`, gender: 'Boys & Girls', sport: season === 'cc' ? 'Cross Country' : 'Track & Field', season, year: `${schoolYear}-${schoolYear + 1}`, provider: 'MileSplit', key: `milesplit:${school.milesplitId}:${season}:${schoolYear}`, url: `https://ms.milesplit.com/api/v1/teams/${school.milesplitId}/schedules?season=${season}&year=${schoolYear}` };
      console.log(`  MileSplit ${school.name} ${season}`);
      try {
        const items = meetItems(JSON.parse(await get(source.url)), school, season, schoolYear);
        const events = [];
        for (const item of items) {
          if (!meets.has(item.meetId)) meets.set(item.meetId, await get(`https://ms.milesplit.com/meets/${item.meetId}`));
          const event = parseMeet(meets.get(item.meetId), item, source, school);
          if (event) events.push(event);
        }
        sources[source.key] = { ...source, events, lastSuccess: now.toISOString(), error: null, note: events.length ? '' : 'No varsity meets published on MileSplit' }; successful++;
      } catch (err) {
        sources[source.key] = { ...source, ...(previous[source.key] || { events: [] }), error: err.message };
        issues.push(`MileSplit ${school.name} ${season}: ${err.message}`);
      }
    }
  }
  return { sources, issues, successful };
}
