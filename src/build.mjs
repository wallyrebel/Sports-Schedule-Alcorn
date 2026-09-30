import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('docs', { recursive: true });
for (const file of ['calendar.js', 'calendar.css']) await copyFile(`wordpress/alcorn-sports-sync/${file}`, `docs/${file}`);
await writeFile('docs/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alcorn County Sports Schedule</title><link rel="stylesheet" href="calendar.css"></head><body style="margin:0;padding:24px"><main><div class="acs-calendar" data-feed="schedule.json"></div></main><script src="calendar.js"></script></body></html>\n');
