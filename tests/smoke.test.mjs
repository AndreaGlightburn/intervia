// Prova dell'app intera in un browser simulato (jsdom) con risposte finte dei servizi.
// Non usa la rete: verifica il comportamento dell'interfaccia, non la qualità dei dati reali.
// Esecuzione:  cd tests && npm install && node smoke.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script src="https:\/\/unpkg[^>]*><\/script>/, '');          // Leaflet non serve qui
const sleep = ms => new Promise(r => setTimeout(r, ms));

const Z = s => `2026-11-16T${s}:00Z`;
const L = (mode, a, b, extra = {}) => ({ mode, startTime: Z(a), endTime: Z(b), duration: (Date.parse(Z(b)) - Date.parse(Z(a))) / 1000,
  from: { name: 'Da ' + mode, lat: 45.40, lon: 8.92, departure: Z(a), scheduledDeparture: Z(a) },
  to: { name: 'A ' + mode, lat: 45.46, lon: 9.18, arrival: Z(b), scheduledArrival: Z(b) }, agencyName: 'Trenord', tripId: mode + a, ...extra });
const IT = (...legs) => ({ legs, startTime: legs[0].startTime, endTime: legs.at(-1).endTime, duration: (Date.parse(legs.at(-1).endTime) - Date.parse(legs[0].startTime)) / 1000 });

async function boot(handler) {
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://andreaglightburn.github.io/intervia/', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => { calls.push(String(url)); return handler(String(url), opts, w); };
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
    } });
  await sleep(30);
  return { w: dom.window, d: dom.window.document, calls };
}
const json = (w, body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
function setPlaces(w, from = '45.400000,8.920000', to = '45.460000,9.180000') {
  w.eval(`sel.from = {label:'Via Roma 1, Abbiategrasso', place:'${from}', lat:45.4, lon:8.92}; sel.to = {label:'Via Magenta 5, Milano', place:'${to}', lat:45.46, lon:9.18};`);
}
const submit = (w, d) => d.getElementById('f').dispatchEvent(new w.Event('submit', { cancelable: true }));
async function until(fn, ms = 2000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(20); } return false; }

let passed = 0, failed = 0;
async function test(title, fn) { try { await fn(); passed++; console.log('  ✔', title); } catch (e) { failed++; console.log('  ✘', title, '\n     ', e.message); } }

await test('ricerca normale: mostra le soluzioni con orari e cammino', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/plan?') ? json(w, { itineraries: [IT(L('WALK', '07:00', '07:06', { distance: 450 }), L('REGIONAL_RAIL', '07:10', '07:40'))] }) : json(w, []));
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1), d.getElementById('out').textContent);
  assert.match(d.getElementById('out').textContent, /450 m a piedi/);
});

await test('errore 400: si tolgono parametri facoltativi, mai il filtro dei mezzi', async () => {
  let n = 0; const seen = [];
  const { w, d } = await boot((u, o, w) => {
    if (!u.includes('/plan?')) return json(w, []);
    seen.push(new URL(u).searchParams.get('transitModes')); n++;
    return n === 1 ? json(w, { error: 'bad' }, 400) : json(w, { itineraries: [IT(L('BUS', '07:10', '07:40'))] });
  });
  w.eval(`document.querySelectorAll('#modes .chip').forEach(c => c.classList.toggle('on', ['bus'].includes(c.dataset.g)))`);
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1));
  assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]); assert.equal(seen[1], 'BUS');
});

await test('mezzo escluso: le soluzioni che lo usano non compaiono e si dice quante sono', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/plan?') ? json(w, { itineraries: [IT(L('TRAM', '07:00', '07:20')), IT(L('BUS', '07:05', '07:30'))] }) : json(w, []));
  w.eval(`document.querySelectorAll('#modes .chip').forEach(c => c.classList.toggle('on', c.dataset.g !== 'tram'))`);
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1));
  assert.ok(!/🚊/.test(d.querySelector('.it').textContent));
  assert.match(d.getElementById('out').textContent, /1 soluzioni nascoste/);
});

await test('nessun risultato da indirizzo → fermata vicina CON tratto a piedi calcolato', async () => {
  const { w, d } = await boot((u, o, w) => {
    const p = new URL(u).searchParams;
    if (u.includes('/reverse-geocode')) return json(w, [{ type: 'STOP', id: 'stop-1', name: 'Fermata Vicina', lat: 45.402, lon: 8.921 }]);
    if (u.includes('/plan?') && p.get('transitModes') === '') return json(w, { direct: [{ duration: 420, legs: [L('WALK', '06:00', '06:07', { distance: 520 })] }] });
    if (u.includes('/plan?') && p.get('fromPlace') === 'stop-1') return json(w, { itineraries: [IT(L('REGIONAL_RAIL', '07:20', '07:50'))] });
    if (u.includes('/plan?')) return json(w, { itineraries: [] });
    return json(w, []);
  });
  setPlaces(w, '45.400000,8.920000', 'stop-dest'); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1), d.getElementById('out').textContent);
  const t = d.getElementById('out').textContent;
  assert.match(t, /fermata più vicina/); assert.match(t, /520 m a piedi/);
  assert.match(d.querySelector('.it .times').textContent, /08:13/, 'partenza anticipata di 7 minuti di cammino (07:20 UTC = 08:20 Roma)');
});

await test('cammino non calcolabile → avviso esplicito, nessun minuto inventato', async () => {
  const { w, d } = await boot((u, o, w) => {
    const p = new URL(u).searchParams;
    if (u.includes('/reverse-geocode')) return json(w, [{ type: 'STOP', id: 'stop-1', name: 'Fermata Vicina', lat: 45.402, lon: 8.921 }]);
    if (u.includes('/plan?') && p.get('transitModes') === '') return json(w, { error: 'x' }, 500);
    if (u.includes('/plan?') && p.get('fromPlace') === 'stop-1') return json(w, { itineraries: [IT(L('REGIONAL_RAIL', '07:20', '07:50'))] });
    if (u.includes('/plan?')) return json(w, { itineraries: [] });
    return json(w, []);
  });
  setPlaces(w, '45.400000,8.920000', 'stop-dest'); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1));
  const t = d.getElementById('out').textContent;
  assert.match(t, /Manca un tratto a piedi/); assert.match(t, /cammino n\.d\./);
});

await test('fermata troppo lontana (> 2,5 km): nessun fallback silenzioso', async () => {
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('/reverse-geocode')) return json(w, [{ type: 'STOP', id: 'stop-far', name: 'Lontana', lat: 45.5, lon: 8.92 }]);
    if (u.includes('/plan?')) return json(w, { itineraries: [] });
    return json(w, []);
  });
  setPlaces(w, '45.400000,8.920000', 'stop-dest'); submit(w, d);
  assert.ok(await until(() => /Nessuna soluzione/.test(d.getElementById('out').textContent)));
  assert.ok(!/fermata più vicina \(/.test(d.getElementById('out').textContent));
});

await test('due ricerche ravvicinate: il risultato vecchio non sostituisce il nuovo', async () => {
  let n = 0;
  const { w, d } = await boot((u, o, w) => {
    if (!u.includes('/plan?')) return json(w, []);
    const mine = ++n;
    return new Promise((res, rej) => {
      o.signal?.addEventListener('abort', () => rej(new w.DOMException('a', 'AbortError')));
      setTimeout(() => res(json(w, { itineraries: [IT(L(mine === 1 ? 'TRAM' : 'BUS', '07:00', '07:30'))] })), mine === 1 ? 300 : 30);
    });
  });
  setPlaces(w); submit(w, d); await sleep(10); submit(w, d);
  await sleep(500);
  const cards = d.querySelectorAll('.it');
  assert.equal(cards.length, 1); assert.match(cards[0].textContent, /🚌/); assert.ok(!/🚊/.test(cards[0].textContent));
});

await test('servizio lento: timeout con messaggio leggibile, nessun blocco', async () => {
  const { w, d } = await boot((u, o, w) => new Promise((_, rej) => o.signal?.addEventListener('abort', () => rej(new w.DOMException('a', 'AbortError')))));
  w.eval(`window.__fetchT = fetchT; fetchT = (u, o, ms) => window.__fetchT(u, o, 80);`);   // accelera il timeout per il test
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => /non ha risposto in tempo/.test(d.getElementById('out').textContent), 3000), d.getElementById('out').textContent);
  assert.equal(d.getElementById('go').disabled, false);
});

await test('arrivo dopo mezzanotte: indicato "+1 g"', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/plan?') ? json(w, { itineraries: [IT(L('NIGHT_RAIL', '22:40', '23:30'))] }) : json(w, []));
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1));
  assert.match(d.querySelector('.it .times').textContent, /23:40 → 00:30 \+1 g/);
});

await test('pulsante biglietti: etichetta onesta (sito dell\'operatore)', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/plan?') ? json(w, { itineraries: [IT(L('REGIONAL_RAIL', '07:10', '07:40'))] }) : json(w, []));
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1));
  const t = [...d.querySelectorAll('.tix a')].map(a => a.textContent).join(' | ');
  assert.match(t, /Sito Trenord/); assert.ok(!/Biglietto /.test(t));
});

await test('pagina informazioni: versione e autore', async () => {
  const { w, d } = await boot((u, o, w) => json(w, u.includes('version.json') ? { version: '2.1.0' } : []));
  d.getElementById('infobtn').click();
  assert.equal(d.getElementById('infoModal').style.display, 'flex');
  assert.equal(d.getElementById('infoVer').textContent, w.eval('APP_VERSION'));
  assert.equal(d.getElementById('infoAuthor').textContent, 'Pony10');
});
await test('controllo aggiornamenti: confronto versioni', async () => {
  const { w } = await boot((u, o, w) => json(w, []));
  assert.ok(w.eval("vNum('2.10.0') > vNum('2.9.9') && vNum('2.1.0') === vNum('2.1.0') && !(vNum('2.0.9') > vNum('2.1.0'))"));
});

await test('linee di una città: server bloccato, risponde il collegamento diretto entro pochi secondi', async () => {
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('api.php')) return new Promise((_, rej) => o.signal?.addEventListener('abort', () => rej(new w.DOMException('a', 'AbortError'))));   // server che non risponde
    if (u.includes('photon')) return json(w, { features: [] });
    if (u.includes('interpreter')) return json(w, { elements: [{ type: 'relation', id: 7, tags: { ref: '1', route: 'bus', name: 'Bus 1' } }] });
    return json(w, []);
  });
  const t0 = Date.now();
  w.eval("runCityLines('Udine')");
  assert.ok(await until(() => /1 linee/.test(d.getElementById('lout').textContent), 9000), d.getElementById('lout').textContent);
  assert.ok(Date.now() - t0 < 9000);
});
await test('linee di una città: tutto non disponibile → errore con entrambe le cause, nessuna attesa infinita', async () => {
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('api.php')) return Promise.reject(new TypeError('fail'));
    if (u.includes('interpreter')) return json(w, {}, 504);
    return json(w, { features: [] });
  });
  w.eval("runCityLines('Udine')");
  assert.ok(await until(() => /Server dati:.*Collegamento diretto:/.test(d.getElementById('lout').textContent), 9000), d.getElementById('lout').textContent);
  assert.equal(d.getElementById('citygo').disabled, false);
});
await test('linee di una città: "Annulla" ferma la ricerca', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('photon') ? json(w, { features: [] }) : new Promise((_, rej) => o.signal?.addEventListener('abort', () => rej(new w.DOMException('a', 'AbortError')))));
  w.eval("runCityLines('Udine')");
  assert.ok(await until(() => d.getElementById('citystop')));
  d.getElementById('citystop').click();
  await sleep(100);
  assert.match(d.getElementById('lout').textContent, /annullata/); assert.equal(d.getElementById('citygo').disabled, false);
});

await test('linee di una città dagli orari (senza OpenStreetMap): linee, direzioni e fermate', async () => {
  let overpassCalls = 0;
  const { w, d, calls } = await boot((u, o, w) => {
    if (u.includes('photon')) return json(w, { features: [{ geometry: { coordinates: [13.23, 46.06] }, properties: { osm_type: 'R', osm_id: 41, name: 'Udine', extent: [13.15, 46.10, 13.30, 46.02] } }] });
    if (u.includes('/map/stops')) return json(w, [{ stopId: 's1', name: 'Piazza Libertà', lat: 46.06, lon: 13.23 }, { stopId: 's2', name: 'Stazione FS', lat: 46.05, lon: 13.24 }]);
    if (u.includes('/stoptimes')) return json(w, { stopTimes: [
      { mode: 'BUS', routeShortName: '1', headsign: 'Ospedale', tripId: 't1', agencyName: 'Arriva Udine', routeColor: 'E30613' },
      { mode: 'BUS', routeShortName: '1', headsign: 'Stazione', tripId: 't2', agencyName: 'Arriva Udine' },
      { mode: 'REGIONAL_RAIL', displayName: 'R 20871', headsign: 'Trieste C.le', tripId: 't3', agencyName: 'Trenitalia' } ] });
    if (u.includes('/trip?')) return json(w, { legs: [{ tripId: 't1', mode: 'BUS', routeShortName: '1', from: { name: 'Stazione', lat: 46.05, lon: 13.24, departure: Z('07:00') }, intermediateStops: [{ name: 'Piazza Libertà', lat: 46.06, lon: 13.23, arrival: Z('07:05') }], to: { name: 'Ospedale', lat: 46.07, lon: 13.22, arrival: Z('07:12') } }] });
    if (u.includes('interpreter') || u.includes('api.php')) { overpassCalls++; return json(w, {}, 500); }
    return json(w, []);
  });
  w.eval("runCityLines('Udine')");
  assert.ok(await until(() => /2 linee/.test(d.getElementById('lout').textContent), 6000), d.getElementById('lout').textContent);
  const chips = [...d.querySelectorAll('#lout .chip[data-g]')].map(c => c.textContent);
  assert.ok(chips.includes('1') && chips.includes('R'), 'il numero del treno non diventa una linea: ' + chips);
  assert.equal(overpassCalls, 0, 'OpenStreetMap non interrogato');
  const ms = new URL(calls.find(u => u.includes('/map/stops'))).searchParams;
  const [minLat, minLon] = ms.get('min').split(',').map(Number), [maxLat, maxLon] = ms.get('max').split(',').map(Number);
  assert.ok(minLat < maxLat && minLon > maxLon, 'min = sud-est, max = nord-ovest come da documentazione MOTIS');
  d.querySelector('#lout .chip[data-g]').click();
  const dirs = d.querySelectorAll('#cityline .ttdir');
  assert.equal(dirs.length, 2);
  dirs[0].click();
  assert.ok(await until(() => /Piazza Libertà/.test(dirs[0].textContent)), dirs[0].textContent);
});

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
