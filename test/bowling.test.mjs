import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, deduplicate } from '../src/core.mjs';

test('legacy bowling validates the team and season and preserves multi-school meets', () => {
  const source={school:'Corinth',schoolId:'team-id',sport:'Bowling',gender:'Girls',year:'26-27',key:'corinth-girls',url:'https://www.maxpreps.com/'};
  const html=`<meta name="targeting" content='{"mpschoolid":"team-id","gnd":"girls","activity":"bowling","state":"ms"}'>
    <dl><dd id="schedule_Team">Varsity 2026-27</dd></dl><table id="schedule"><tbody>
    <tr class="multi-team-contest"><td><abbr class="event-date">1/20</abbr><abbr class="event-time">TBA</abbr></td>
    <td><div class="contest-name">Corinth vs. Biggersville vs. Kossuth</div><div class="contest-details">Game Details: Plaza Lanes</div></td></tr>
    <tr class="dual-contest"><td><abbr class="event-date">11/12</abbr><abbr class="event-time">3:30p</abbr></td>
    <td><div class="contest-name">Biggersville (MS)</div><div class="contest-details">Game Details: Kossuth Aggies</div></td></tr>
    </tbody></table>`;
  const events=parseSchedule(html,source,[{name:'Kossuth',mascot:'Aggies'}]).events;
  assert.deepEqual(events[0].participants.map(t=>t.name),['Corinth','Biggersville','Kossuth']);
  assert.equal(events[0].date,'2027-01-20');assert.equal(events[0].time,null);
  assert.equal(events[0].location,'Plaza Lanes');assert.match(events[1].title,/opponent unconfirmed/);
  assert.equal(deduplicate([...events,...events]).length,2);
  assert.throws(()=>parseSchedule(html,{...source,gender:'Boys'}),/mismatch/);
  assert.throws(()=>parseSchedule(html,{...source,year:'25-26'}),/mismatch/);
  assert.throws(()=>parseSchedule(html.replace('1/20','2/30'),source),/Invalid bowling date/);
});
