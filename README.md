# Alcorn County Sports Schedule

Live WordPress schedule: https://alcornsportsms.com/schedule/

Corinth, Kossuth, Biggersville and Alcorn Central **boys and girls varsity only**. MaxPreps provides game schedules. MileSplit provides school-listed cross-country, indoor track and outdoor track meets. The source collector and calendar are inspired by [wallyrebel/autoschedule](https://github.com/wallyrebel/autoschedule); this repository operates independently.

## Automatic updates

GitHub Actions runs at minute 17 of every hour, on relevant code changes, and on manual dispatch. Scheduled runs can be delayed by GitHub. It discovers current varsity seasons, checks each source, publishes JSON/ICS, and calls the WordPress importer to confirm the new feed arrived. No Google account or WordPress application password is needed.

The WordPress plugin imports events into **The Events Calendar**. It also schedules an hourly WP-Cron refresh and refreshes its fixed-source cache on schedule-page requests (no more than once every five minutes). GitHub's external check means the normal import does not depend on site visitors or the user's computer being on. The repository's data URL is fixed in the plugin; public requests cannot submit events or choose a different source.

The `/schedule/` page uses `[alcorn_sports_schedule]`, with school, gender, sport and date filters, last-check time, source links and source coverage. The Events Calendar's native month view is at `/events/month/`.

## Source limitations and integrity

- Automatic updates reflect what schools and meet organizers publish. A missing source schedule cannot supply games; coverage explicitly lists empty or failed sources.
- JV, freshman and old seasons are excluded from MaxPreps. Deleted source contests are excluded. County opponents are deduplicated. Stable event IDs update existing WordPress events when dates, times or status change.
- A failing source retains its previous events and reports an issue. If all sources fail, published data is left untouched. A changed/unrecognized schema fails closed rather than replacing a schedule with an empty list.
- MileSplit records are **combined varsity meet entries**, not invented individual boys/girls race assignments. Meets with middle-school-only/JV-only names are excluded. Meet dates come from public SportsEvent metadata. See the linked meet page for race/division assignments and times. No athlete data or paywalled rankings are collected.
- Times use `America/Chicago`, including daylight saving transitions. Unknown game/race times are labelled TBD, represented as date-only in ICS and all-day in WordPress. WordPress uses an explicitly disclosed two-hour display estimate for known-time event ends.
- Managed future events removed from a successful feed become drafts, not permanently deleted. Manual events and past events are untouched. ICS retains cancellation records for removed events within the retention window.
- The front end alerts readers if a source check is delayed more than six hours or has partial failures. GitHub marks the workflow failed on source/import problems; repository owners can use normal GitHub Actions failure notifications.

## Operations

WordPress: **Events → Alcorn Schedule Sync** shows import status, source coverage and a **Sync now** button. Lasting schedule corrections should be made at the source; local edits to managed event titles/times may be overwritten by subsequent source updates.

GitHub: **Actions → Update Alcorn varsity schedules → Run workflow** rechecks all sources. Review the fetch log for a failed school or changed source format.

## Development and deployment

Node.js 22 or newer; no npm dependencies. Run:

```sh
node --test test/*.test.mjs
php -l wordpress/alcorn-sports-sync/alcorn-sports-sync.php
php test/wordpress-sync.php
node src/update.mjs
node src/build.mjs
```

To deploy the WordPress bridge, zip the `wordpress/alcorn-sports-sync/` directory and upload via Plugins → Add Plugin → Upload Plugin. The Events Calendar must be installed and active. Activate the bridge and add its shortcode to the published Schedule page. Future bridge code changes require uploading the updated plugin ZIP; data updates require no redeployment.

`docs/state.json` is public schedule-only recovery state. `docs/schedule.json` is the public display feed; `docs/schedule.ics` is an optional subscribable feed. Never put credentials in this repository.
