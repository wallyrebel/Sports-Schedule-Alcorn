(() => {
  'use strict';
  const icons = { Football: '🏈', Basketball: '🏀', Baseball: '⚾', Softball: '🥎', Volleyball: '🏐', Soccer: '⚽', Tennis: '🎾', Golf: '⛳', Bowling: '🎳', 'Cross Country': '🏃', 'Track & Field': '🏃', Swimming: '🏊', 'Weight Lifting': '🏋️' };
  const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
  const centralDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dayLabel = date => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(date + 'T12:00:00Z'));
  const timeLabel = time => { if (!time) return 'Time TBD'; const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
  function link(text, url, className) { const a = el('a', text, className); a.href = url; return a; }
  for (const root of document.querySelectorAll('.acs-calendar')) {
    let data, limit = 60, selections = { school: '', gender: '', sport: '', range: 'all' };
    const shell = el('section'); shell.setAttribute('aria-label', 'Alcorn County varsity sports schedule');
    const intro = el('div', undefined, 'acs-intro');
    intro.append(el('p', 'FOUR SCHOOLS · ONE SCHEDULE', 'acs-eyebrow'), el('h2', 'Upcoming Alcorn County games'), el('p', 'Corinth Warriors · Kossuth Aggies · Biggersville Lions · Alcorn Central Golden Bears', 'acs-schools'), el('p', 'Boys and girls varsity. All times Central. Automatically checked hourly.', 'acs-note'));
    const status = el('p', 'Loading the latest schedules…', 'acs-updated'); status.setAttribute('role', 'status');
    const warning = el('p', '', 'acs-warning'); warning.hidden = true;
    const filters = el('div', undefined, 'acs-filters');
    const controls = {};
    function select(key, title, options) {
      const label = el('label', title); const input = el('select'); input.setAttribute('aria-label', title);
      options.forEach(([value, name]) => { const option = el('option', name); option.value = value; input.append(option); });
      input.value = selections[key]; input.addEventListener('change', () => { selections[key] = input.value; limit = 60; render(); });
      label.append(input); filters.append(label); controls[key] = input;
    }
    select('school', 'School', [['', 'All four schools'], ...['Corinth', 'Kossuth', 'Biggersville', 'Alcorn Central'].map(s => [s, s])]);
    select('gender', 'Teams', [['', 'Boys & girls'], ['Boys', 'Boys'], ['Girls', 'Girls']]);
    select('sport', 'Sport', [['', 'All sports']]);
    select('range', 'Dates', [['all', 'All upcoming'], ['7', 'Next 7 days'], ['30', 'Next 30 days']]);
    const toolbar = el('div', undefined, 'acs-toolbar'); const count = el('p', '', 'acs-count'); count.setAttribute('aria-live', 'polite');
    const reset = el('button', 'Reset filters', 'acs-reset'); reset.type = 'button'; reset.addEventListener('click', () => { selections = { school: '', gender: '', sport: '', range: 'all' }; Object.entries(controls).forEach(([k, n]) => n.value = selections[k]); limit = 60; render(); });
    toolbar.append(count, reset);
    if (root.dataset.monthUrl) toolbar.append(link('Month calendar →', root.dataset.monthUrl, 'acs-month-link'));
    const list = el('div', undefined, 'acs-games'); const more = el('button', 'Show more events', 'acs-more'); more.type = 'button'; more.hidden = true; more.addEventListener('click', () => { limit += 60; render(); });
    const coverage = el('details', undefined, 'acs-coverage'); coverage.append(el('summary', 'Schedule sources & coverage'));
    const coverageBody = el('div'); coverage.append(coverageBody);
    const note = el('p', 'Schedules are supplied by MaxPreps and MileSplit and may change. Sports without published schedules will appear when the source adds games. Confirm last-minute changes with the school.', 'acs-footnote');
    shell.append(intro, status, warning, filters, toolbar, list, more, coverage, note); root.replaceChildren(shell);
    function render() {
      if (!data) return;
      const today = centralDay();
      const until = selections.range === 'all' ? '9999-12-31' : new Date(Date.parse(today + 'T12:00:00Z') + Number(selections.range) * 86400000).toISOString().slice(0, 10);
      const events = data.events.filter(e => e.date >= today && e.date < until && (!selections.school || e.schools.includes(selections.school)) && (!selections.gender || e.gender === selections.gender || e.gender === 'Boys & Girls') && (!selections.sport || e.sport === selections.sport));
      count.textContent = `${events.length} upcoming games & meets`;
      list.replaceChildren(); let lastDate = '';
      for (const e of events.slice(0, limit)) {
        if (e.date !== lastDate) { list.append(el('h3', dayLabel(e.date) + (e.date === today ? ' · Today' : ''), 'acs-day')); lastDate = e.date; }
        const row = el('article', undefined, 'acs-game');
        row.append(el('div', timeLabel(e.time), 'acs-time'));
        const info = el('div', undefined, 'acs-game-info');
        info.append(el('div', `${icons[e.sport] || '🏅'} ${e.gender} ${e.sport}`, 'acs-sport'));
        info.append(link(e.title, e.eventUrl || e.sourceUrl, 'acs-matchup'));
        info.append(el('div', e.location, 'acs-location'));
        if (e.sourceName === 'MileSplit') info.append(el('div', 'Varsity meet · see source for race assignments and times', 'acs-location'));
        const tags = el('div', undefined, 'acs-tags');
        e.schools.forEach(name => { const tag = el('span', name, 'acs-tag'); tag.style.borderColor = data.schools.find(s => s.name === name)?.color || '#872434'; tags.append(tag); });
        if (e.status !== 'scheduled') tags.append(el('strong', e.status.toUpperCase(), 'acs-event-status'));
        info.append(tags); row.append(info, link('Source ↗', e.sourceUrl, 'acs-source')); list.append(row);
      }
      if (!events.length) list.append(el('p', 'No published games match these filters. Try another school, sport, or date range.', 'acs-empty'));
      more.hidden = events.length <= limit;
    }
    async function refresh() {
      try {
        const response = await fetch(root.dataset.feed, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error('Feed unavailable');
        const result = await response.json(); if (!Array.isArray(result.events)) throw new Error('Invalid feed'); data = result;
        const options = [...new Set(data.coverage.map(s => s.sport))].sort();
        controls.sport.replaceChildren(); [['', 'All sports'], ...options.map(s => [s, s])].forEach(([v, name]) => { const o = el('option', name); o.value = v; controls.sport.append(o); }); controls.sport.value = selections.sport;
        const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(data.lastChecked));
        status.textContent = `Last source check: ${stamp}`;
        const stale = Date.now() - Date.parse(data.lastChecked) > 6 * 3600000;
        warning.hidden = !(stale || data.issues.length || data.syncError);
        warning.textContent = stale ? 'Schedule updates are delayed. Showing the last available schedule; check the source for recent changes.' : 'Some source schedules could not be refreshed. Their last available games are retained; see coverage below.';
        coverageBody.replaceChildren();
        data.schools.forEach(school => {
          const rows = data.coverage.filter(s => s.school === school.name);
          coverageBody.append(el('h4', school.name));
          const ul = el('ul');
          if (!rows.length) ul.append(el('li', 'Source unavailable; no current schedule data.'));
          rows.forEach(s => ul.append(el('li', `${s.provider || 'MaxPreps'} — ${s.gender} ${s.sport} (${s.year}${s.season ? ', ' + s.season : ''}): ${s.error ? 'Update delayed — previous data retained' : s.upcoming ? s.upcoming + ' upcoming games' : s.note || 'No upcoming games posted'}`)));
          coverageBody.append(ul);
        }); render();
      } catch {
        status.textContent = data ? status.textContent : 'The schedule is temporarily unavailable.';
        warning.hidden = false; warning.textContent = data ? 'Unable to refresh right now. Showing the last loaded schedule.' : 'Please reload in a moment, or use the month calendar link to view imported games.';
      }
    }
    refresh(); setInterval(refresh, 300000);
  }
})();
