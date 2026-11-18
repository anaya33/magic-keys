/**
 * Developer tool (tools/sheet-previews.html): draws the opening bars of every built-in
 * song with exactly the app's engraving settings, at zoom 1, and saves each as an SVG
 * picture in public/sheet-previews/. The app shows these instantly while the live
 * sheet music engine starts (see ui/sheet.ts).
 */
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { FIRST_BARS, SHEET_OPTIONS } from '../ui/sheet';

const files = import.meta.glob(['/songs/*.musicxml', '/songs/*.xml'], { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;
const log = document.getElementById('log')!;
const lines: string[] = [];

for (const [path, read] of Object.entries(files)) {
  const id = path.split('/').pop()!.replace(/\.(musicxml|xml)$/, '');
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:1200px';
  document.body.append(host);
  const osmd = new OpenSheetMusicDisplay(host, {
    ...(SHEET_OPTIONS as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]),
    drawFromMeasureNumber: 1,
    drawUpToMeasureNumber: FIRST_BARS,
  });
  osmd.setLogLevel('error');
  await osmd.load(await read());
  osmd.zoom = 1;
  osmd.render();
  const svg = host.querySelector('svg')!;
  const width = Math.ceil(parseFloat(svg.getAttribute('width') ?? '0'));
  const height = Math.ceil(parseFloat(svg.getAttribute('height') ?? '0'));
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  // Coordinates to one decimal place (invisible on screen, far smaller file), and no ids
  // that could clash with the live score's.
  const markup = svg.outerHTML.replace(/(\d+\.\d)\d+/g, '$1').replace(/ id="[^"]*"/g, '');
  const res = await fetch(`/__save-sheet-preview?id=${encodeURIComponent(id)}`, { method: 'POST', body: markup });
  lines.push(`${id}: ${width}×${height} ${res.ok ? 'saved' : 'FAILED'} (${Math.round(markup.length / 1024)} KB)`);
  host.remove();
}
log.textContent = lines.join('\n') + '\nDone.';
