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
  // OpenStreetMap viene interrogato solo dopo, in sottofondo, per le linee senza orari (qui fallisce: l'elenco resta)
  assert.ok(await until(() => /OpenStreetMap non raggiungibile ora/.test(d.getElementById('lout').textContent), 8000));
  const ms = new URL(calls.find(u => u.includes('/map/stops'))).searchParams;
  const [minLat, minLon] = ms.get('min').split(',').map(Number), [maxLat, maxLon] = ms.get('max').split(',').map(Number);
  assert.ok(minLat < maxLat && minLon > maxLon, 'min = sud-est, max = nord-ovest come da documentazione MOTIS');
  d.querySelector('#lout .chip[data-g]').click();
  const dirs = d.querySelectorAll('#cityline .ttdir');
  assert.equal(dirs.length, 2);
  dirs[0].click();
  assert.ok(await until(() => /Piazza Libertà/.test(dirs[0].textContent)), dirs[0].textContent);
});

await test('"Cerca altre linee": legge altre fermate e aggiunge le linee nuove senza perdere le vecchie', async () => {
  const stops = Array.from({ length: 40 }, (_, i) => ({ stopId: 's' + i, name: 'F' + i, lat: 45.4 + (i % 7) * 0.01, lon: 9.1 + Math.floor(i / 7) * 0.01 }));
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('photon')) return json(w, { features: [{ geometry: { coordinates: [9.13, 45.43] }, properties: { osm_type: 'R', osm_id: 44915, name: 'Milan', extent: [9.09, 45.47, 9.17, 45.39] } }] });
    if (u.includes('/map/stops')) return json(w, stops);
    if (u.includes('/stoptimes')) { const id = new URL(u).searchParams.get('stopId'); return json(w, { stopTimes: [{ mode: 'BUS', routeShortName: 'L' + id.slice(1), headsign: 'X', tripId: 't' + id, agencyName: 'ATM' }] }); }
    return json(w, []);
  });
  w.eval("runCityLines('milano')");
  assert.ok(await until(() => /30 linee/.test(d.getElementById('lout').textContent), 6000), d.getElementById('lout').textContent);
  assert.match(d.getElementById('lout').textContent, /^Milano:/, 'nome del comune come scritto (in italiano)');
  d.getElementById('citymore').click();
  assert.ok(await until(() => /40 linee/.test(d.getElementById('lout').textContent), 6000), d.getElementById('lout').textContent);
  assert.match(d.getElementById('lout').textContent, /Trovate 10 linee nuove/);
  assert.ok(!d.getElementById('citymore'), 'nessun pulsante quando non restano fermate');
});

await test('linea: corsa all\'orario scelto, successiva e orario di tutta la giornata', async () => {
  // corse della linea 1 → Ospedale ogni ora dalle 05:00 alle 23:00 UTC del 16/11 (06:00–00:00 ora italiana)
  const runs = Array.from({ length: 19 }, (_, i) => { const h = String(5 + i).padStart(2, '0'); return { mode: 'BUS', routeShortName: '1', headsign: 'Ospedale', tripId: 'r' + h, place: { departure: `2026-11-16T${h}:10:00Z` } }; });
  const other = { mode: 'BUS', routeShortName: '2', headsign: 'Centro', tripId: 'x', place: { departure: '2026-11-16T09:00:00Z' } };
  const { w, d } = await boot((u, o, w) => {
    const q = new URL(u).searchParams;
    if (u.includes('/stoptimes')) {
      const t = Date.parse(q.get('time') || '2026-11-16T00:00:00Z');
      return json(w, { stopTimes: [...runs, other].filter(x => Date.parse(x.place.departure) >= t).slice(0, +q.get('n')) });
    }
    if (u.includes('/trip?')) { const id = q.get('tripId'), h = id.slice(1);
      return json(w, { legs: [{ tripId: id, mode: 'BUS', routeShortName: '1', headsign: 'Ospedale', from: { name: 'Stazione', stopId: 's0', lat: 46, lon: 13, departure: `2026-11-16T${h}:10:00Z`, scheduledDeparture: `2026-11-16T${h}:10:00Z` }, intermediateStops: [], to: { name: 'Ospedale', stopId: 's9', lat: 46.01, lon: 13.01, arrival: `2026-11-16T${h}:30:00Z` } }] }); }
    return json(w, []);
  });
  // orario di riferimento: 16/11 ore 12:00 italiane (11:00 UTC)
  w.eval(`refState.lines = romeISO('2026-11-16', '12:00')`);
  w.eval(`window.__det = document.createElement('div'); document.body.appendChild(__det);
    variantFromTrip('r06', {headsign:'Ospedale'}).then(v => openLineVariant(__det, v, '1'));`);
  const det = () => w.__det;
  assert.ok(await until(() => /Corsa delle 12:10/.test(det().textContent), 4000), det().textContent.slice(0, 200));
  det().querySelector('[data-nav="1"]').click();
  assert.ok(await until(() => /Corsa delle 13:10/.test(det().textContent), 4000), 'successiva: ' + det().textContent.slice(0, 120));
  det().querySelector('[data-day]').click();
  assert.ok(await until(() => /18 partenze/.test(det().textContent), 6000), det().textContent.slice(0, 300));   // la corsa delle 23:10 UTC è già il 17/11 in Italia
  assert.equal(det().querySelectorAll('[data-run]').length, 18, 'solo la linea 1 verso Ospedale, solo il 16/11 ora italiana');
  det().querySelector('[data-run="r20"]').click();
  assert.ok(await until(() => /Corsa delle 21:10/.test(det().textContent), 4000));
});

await test('città: linee note solo a OpenStreetMap mostrate a parte come "senza orari"', async () => {
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('photon')) return json(w, { features: [{ geometry: { coordinates: [13.23, 46.06] }, properties: { osm_type: 'R', osm_id: 41, name: 'Udine', extent: [13.15, 46.10, 13.30, 46.02] } }] });
    if (u.includes('/map/stops')) return json(w, [{ stopId: 's1', name: 'Stazione', lat: 46.06, lon: 13.23 }]);
    if (u.includes('/stoptimes')) return json(w, { stopTimes: [{ mode: 'BUS', routeShortName: '1', headsign: 'Ospedale', tripId: 't1', agencyName: 'X' }, { mode: 'REGIONAL_RAIL', displayName: 'R 20871', headsign: 'Trieste', tripId: 't3' }] });
    if (u.includes('api.php')) return json(w, { ok: true, elements: [
      { type: 'relation', id: 1, tags: { route: 'bus', ref: '1', name: 'Linea 1' } },
      { type: 'relation', id: 2, tags: { route: 'bus', ref: 'T', name: 'Linea T - Giro Nord', operator: 'TPL FVG', network: 'Arriva Udine' } },
      { type: 'relation', id: 3, tags: { route: 'bus', ref: 'T', name: 'Linea T - Giro Sud' } } ] });
    return json(w, []);
  });
  w.eval("runCityLines('Udine')");
  assert.ok(await until(() => /Altre linee note a OpenStreetMap · 1/.test(d.getElementById('lout').textContent), 8000), d.getElementById('lout').textContent.slice(-400));
  assert.match(d.getElementById('cityosm').textContent, /orari non sono nei dati aperti/);
  d.querySelector('#cityosm .chip').click();
  assert.match(d.getElementById('cityline').textContent, /Linea T · 2 percorsi/);
  const ag = d.getElementById('cityag');
  assert.match(ag.textContent, /Aziende di trasporto · 2/);   // X (dagli orari) e TPL FVG (solo OpenStreetMap); il treno senza nome azienda non conta
  assert.ok([...ag.querySelectorAll('a')].some(a => a.href === 'https://tplfvg.it/'), 'sito TPL FVG');
  assert.match(ag.textContent, /orari non disponibili nell'app/);
  assert.match(ag.textContent, /Cerca il sito/, 'azienda sconosciuta: solo link di ricerca dichiarato');
});

console.log('Rilascio 2.4.1');
await test('A1: con l\'app aperta da ore la ricerca usa "adesso" se l\'orario non è stato scelto', async () => {
  let asked = null;
  const { w, d } = await boot((u, o, w) => { if (u.includes('/plan?')) asked = new URL(u).searchParams.get('time'); return json(w, { itineraries: [] }); });
  d.getElementById('time').value = '05:00'; d.getElementById('date').value = '2020-01-01';   // valore "vecchio" lasciato dall'apertura
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => asked));
  assert.ok(Math.abs(Date.parse(asked) - Date.now()) < 120000, 'orario richiesto ≈ adesso: ' + asked);
  // se l'utente sceglie un orario, viene rispettato
  d.getElementById('date').value = '2026-12-24'; d.getElementById('time').value = '08:15';
  d.getElementById('time').dispatchEvent(new w.Event('change')); asked = null; submit(w, d);
  assert.ok(await until(() => asked)); assert.equal(asked, '2026-12-24T07:15:00.000Z');
  d.getElementById('routeNow').click(); asked = null; submit(w, d);
  assert.ok(await until(() => asked)); assert.ok(Math.abs(Date.parse(asked) - Date.now()) < 120000, '"Adesso" ripristina l\'ora attuale');
});
await test('A2: l\'aggiornamento automatico del tabellone non svuota la pagina', async () => {
  let slow = false;
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('/stoptimes')) return slow ? new Promise(r => setTimeout(() => r(json(w, { stopTimes: [] })), 300)) : json(w, { stopTimes: [{ mode: 'BUS', routeShortName: '1', headsign: 'X', tripId: 't', place: { departure: Z('09:00') } }] });
    return json(w, []);
  });
  w.eval(`openStation({id:'s1', name:'Duomo'})`);
  assert.ok(await until(() => /Duomo/.test(d.getElementById('stout').textContent) && d.querySelector('#stout .brow')));
  slow = true; w.eval('loadBoard(true)'); await sleep(50);
  assert.ok(d.querySelector('#stout .brow'), 'la tabella resta visibile durante l\'aggiornamento');
  assert.ok(!/Carico il tabellone/.test(d.getElementById('stout').textContent));
});
await test('A3: "La mia posizione" salvata nelle recenti senza coordinate e riletta al riuso', async () => {
  const { w, d } = await boot((u, o, w) => json(w, { itineraries: [] }));
  let lat = 45.4001;
  Object.defineProperty(w.navigator, 'geolocation', { value: { getCurrentPosition: ok => ok({ coords: { latitude: lat, longitude: 8.9201 } }) } });
  d.getElementById('gps').click(); await sleep(20);
  w.eval(`sel.to = {label:'Milano Centrale', place:'stop-mc'}`);
  submit(w, d); await sleep(50);
  const rec = JSON.parse(w.localStorage.getItem('intervia.recent'))[0];
  assert.equal(rec.from.gps, true); assert.equal(rec.from.place, undefined, 'nessuna coordinata salvata');
  lat = 45.9; d.querySelector('#recent .li-main').click(); await sleep(30);
  assert.match(w.eval('sel.from.place'), /^45\.9/, 'posizione riletta, non quella vecchia');
});
await test('A4: dopo la ricerca la pagina scorre ai risultati', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/plan?') ? json(w, { itineraries: [IT(L('BUS', '07:10', '07:40'))] }) : json(w, []));
  let scrolled = 0; d.getElementById('out').scrollIntoView = () => { scrolled++; };
  setPlaces(w); submit(w, d);
  assert.ok(await until(() => d.querySelectorAll('.it').length === 1 && scrolled > 0));
});
await test('M1: cancellazione dei dati con conferma e interfaccia aggiornata', async () => {
  const { w, d } = await boot((u, o, w) => json(w, []));
  w.localStorage.setItem('intervia.recent', JSON.stringify([{ from: { label: 'A', place: 'a' }, to: { label: 'B', place: 'b' } }]));
  w.eval('renderRecent()');
  assert.equal(d.querySelectorAll('#recent .li-main').length, 1);
  d.getElementById('infoClear').click();
  assert.ok(w.localStorage.getItem('intervia.recent'), 'primo tocco: nulla cancellato');
  assert.match(d.getElementById('infoClearMsg').textContent, /1 ricerche recenti/);
  d.getElementById('infoClear').click();
  assert.equal(w.localStorage.getItem('intervia.recent'), null);
  assert.equal(d.querySelectorAll('#recent .li-main').length, 0, 'le recenti spariscono subito');
  assert.ok(d.getElementById('recenthead').hidden, 'intestazione nascosta senza recenti');
});
await test('M7: numero treno non valido → messaggio chiaro', async () => {
  const { w, d } = await boot((u, o, w) => json(w, []));
  d.getElementById('trainq').value = 'abc';
  d.getElementById('tf').dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.match(d.getElementById('tout').textContent, /Scrivi solo il numero del treno/);
});

console.log('Rilascio 2.5.0');
await test('pageTitle e aria-current seguono la scheda scelta', async () => {
  const { w, d } = await boot((u, o, w) => json(w, []));
  d.querySelector('#tabs [data-t="train"]').click();
  assert.equal(d.getElementById('pageTitle').textContent, 'Treni');
  assert.equal(d.querySelector('#tabs [aria-current="page"]').dataset.t, 'train');
  assert.equal(d.querySelectorAll('#tabs [aria-current]').length, 1);
  assert.ok(d.getElementById('tab-route').hidden && !d.getElementById('tab-train').hidden);
});
await test('Solo diretti: nessun cambio, scelta salvata, i cambi tornano quando si spegne', async () => {
  const asked = [];
  const { w, d } = await boot((u, o, w) => { if (u.includes('/plan?')) asked.push(new URL(u).searchParams.get('maxTransfers')); return json(w, { itineraries: [] }); });
  d.getElementById('maxT').value = '2';
  const od = d.getElementById('onlyDirect'); od.checked = true; od.dispatchEvent(new w.Event('change'));
  assert.ok(d.getElementById('maxTrow').hidden);
  setPlaces(w); submit(w, d); assert.ok(await until(() => asked.length === 1)); assert.equal(asked[0], '0');
  const pr = JSON.parse(w.localStorage.getItem('intervia.prefs'));
  assert.equal(pr.onlyDirect, true); assert.equal(pr.maxT, '2', 'la scelta dei cambi non si perde');
  od.checked = false; od.dispatchEvent(new w.Event('change'));
  assert.ok(!d.getElementById('maxTrow').hidden);
  submit(w, d); assert.ok(await until(() => asked.length === 2)); assert.equal(asked[1], '2');
});
await test('tema: Scuro/Chiaro/Sistema salvato e applicato anche prima del disegno', async () => {
  const { w, d } = await boot((u, o, w) => json(w, []));
  d.querySelector('#themeSeg [data-th="dark"]').click();
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.equal(JSON.parse(w.localStorage.getItem('intervia.theme')), 'dark');
  assert.ok(d.querySelector('#themeSeg [data-th="dark"]').classList.contains('on'));
  d.querySelector('#themeSeg [data-th=""]').click();
  assert.equal(d.documentElement.dataset.theme, undefined);
  assert.match(html.slice(0, html.indexOf('<style>')), /intervia\.theme/, 'script del tema in testa, prima degli stili');
});
await test('recenti: cestino su una voce e "Cancella" con doppio tocco', async () => {
  const { w, d } = await boot((u, o, w) => json(w, []));
  w.localStorage.setItem('intervia.recent', JSON.stringify([1, 2, 3].map(n => ({ from: { label: 'A' + n, place: 'a' + n }, to: { label: 'B' + n, place: 'b' + n } }))));
  w.eval('renderRecent()');
  assert.ok(!d.getElementById('recenthead').hidden);
  d.querySelector('#recent [data-del="1"]').click();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('intervia.recent')).map(x => x.from.label), ['A1', 'A3']);
  d.getElementById('recentClear').click();
  assert.equal(JSON.parse(w.localStorage.getItem('intervia.recent')).length, 2, 'primo tocco: solo conferma');
  d.getElementById('recentClear').click();
  assert.equal(JSON.parse(w.localStorage.getItem('intervia.recent')).length, 0);
  assert.ok(d.getElementById('recenthead').hidden);
});
await test('tabellone: ritardo, orario previsto, binario cambiato, soppressione', async () => {
  const { w, d } = await boot((u, o, w) => u.includes('/stoptimes') ? json(w, { stopTimes: [
    { mode: 'REGIONAL_RAIL', routeShortName: 'S9', headsign: 'Saronno', agencyName: 'Trenord', tripId: 't1', realTime: true,
      place: { departure: Z('09:07'), scheduledDeparture: Z('09:00'), track: '3', scheduledTrack: '2' } },
    { mode: 'BUS', routeShortName: '91', headsign: 'Lotto', tripId: 't2', realTime: true, cancelled: true, place: { departure: Z('09:10'), scheduledDeparture: Z('09:10') } },
    { mode: 'BUS', routeShortName: '50', headsign: 'Lorenteggio', place: { departure: Z('09:20'), scheduledDeparture: Z('09:20') } }] }) : json(w, []));
  w.eval(`openStation({id:'s1', name:'Milano Cadorna'})`);
  assert.ok(await until(() => d.querySelectorAll('#stout .brow').length === 3));
  const [r1, r2, r3] = d.querySelectorAll('#stout .brow');
  assert.match(r1.querySelector('.bdel').textContent, /\+7′/); assert.match(r1.querySelector('.bx').textContent, /previsto 10:00/);
  assert.ok(r1.querySelector('.bp.real'), 'binario cambiato evidenziato'); assert.equal(r1.dataset.trip, 't1');
  assert.ok(r2.classList.contains('cx')); assert.match(r2.textContent, /Soppresso/);
  assert.match(r3.querySelector('.bdel').textContent, /programmato/, 'senza tempo reale non si dice "in orario"');
  assert.equal(d.querySelector('#stout h2').textContent, 'Milano Cadorna');
  assert.match(d.getElementById('strecent').textContent, /Milano Cadorna/);
});
await test('treno: banner di stato e linea del tempo con fermate passate e prossima', async () => {
  const t0 = Date.now() - 3600e3;
  const { w, d } = await boot((u, o, w) => u.includes('api.php') ? json(w, { ok: true, train: { name: 'REG 24113', number: '24113', o: 'S01', d: '1', origin: 'Milano', destination: 'Novara', delay: 6, lastStation: 'Abbiategrasso', lastTime: t0 + 1800e3,
    stops: [{ name: 'Milano', type: 'P', depSched: t0, depReal: t0 + 60e3, delayDep: 1, track: '5' },
            { name: 'Abbiategrasso', type: 'F', arrSched: t0 + 1700e3, arrReal: t0 + 1800e3, delayArr: 6, depSched: t0 + 1760e3, track: '2', trackSched: '1' },
            { name: 'Novara', type: 'A', arrSched: t0 + 4000e3 }] } }) : json(w, []));
  w.eval(`openTrain('24113')`);
  assert.ok(await until(() => d.querySelector('#tout .tl')));
  assert.match(d.querySelector('#tout .banner').textContent, /In viaggio · ritardo 6 min/);
  const li = d.querySelectorAll('#tout .tl li');
  assert.equal(li.length, 3); assert.ok(li[0].classList.contains('past') && li[1].classList.contains('past') && li[2].classList.contains('next'));
  assert.ok(li[1].querySelector('.tk.chg'), 'binario cambiato');
  assert.ok(!/Arr\./.test(li[0].textContent) && !/Part\./.test(li[2].textContent), 'capolinea: solo partenza / solo arrivo');
  assert.match(d.getElementById('trrecent').textContent, /24113/);
});

console.log('Rilascio 2.6.0');
await test('tabellone: ritardo da ViaggiaTreno sul treno Trenord e treno mancante aggiunto', async () => {
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('/stoptimes')) return json(w, { stopTimes: [{ mode: 'REGIONAL_RAIL', routeShortName: 'R31', displayName: 'R31 10062', headsign: 'Mortara', agencyName: 'Trenord', tripId: 't1',
      place: { departure: Z('15:53'), scheduledDeparture: Z('15:53') } }] });
    if (u.includes('a=board')) return json(w, { ok: true, station: { id: 'S01067', name: 'ABBIATEGRASSO' }, trains: [
      { n: '10062', delay: 8, sched: Date.parse(Z('15:53')), track: '2', trackSched: '1', cancelled: false },
      { n: '10055', cat: 'REG', delay: null, sched: Date.now() + 600e3, dest: 'MILANO ROGOREDO', client: 'Trenord', cancelled: false, o: 'S00249', d: 1 }] });
    return json(w, []);
  });
  w.eval(`openStation({id:'s1', name:'Abbiategrasso'})`);
  assert.ok(await until(() => d.querySelectorAll('#stout .brow').length === 2), d.getElementById('stout').textContent);
  const rowsB = [...d.querySelectorAll('#stout .brow')], first = rowsB.find(r => /10055/.test(r.textContent)), second = rowsB.find(r => /10062/.test(r.textContent));
  assert.match(first.textContent, /Milano Rogoredo/); assert.match(first.textContent, /non ancora partito/); assert.equal(first.dataset.train, '10055');
  assert.match(second.querySelector('.bdel').textContent, /\+8′/); assert.ok(second.querySelector('.bt.late'), 'orario in rosso');
  assert.ok(second.querySelector('.bp.real'));
  assert.match(d.querySelector('.boardsub').textContent, /ViaggiaTreno/);
  assert.ok(d.getElementById('strec'), 'pulsante registra per le stazioni ferroviarie');
});
await test('treno: ritardo coerente con gli orari mostrati e fermata toccabile', async () => {
  const t0 = Date.parse('2026-11-27T05:19:00Z');
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('api.php')) return json(w, { ok: true, train: { name: 'REG 10059', number: '10059', o: 'S00001', d: '1', origin: 'ALESSANDRIA', destination: 'MILANO ROGOREDO', delay: 1, stops: [
      { name: 'ALESSANDRIA', id: 'S00001', type: 'P', depSched: t0, depReal: t0 + 20e3 },
      { name: 'VALENZA', id: 'S00002', type: 'F', arrSched: t0 + 900e3, arrReal: t0 + 900e3 + 50e3, depSched: t0 + 960e3, depReal: t0 + 960e3 + 130e3 },
      { name: 'MILANO ROGOREDO', id: 'S01820', type: 'A', arrSched: t0 + 7200e3 }] } });
    if (u.includes('/geocode')) return json(w, [{ type: 'STOP', id: 'it-valenza', name: 'Valenza', lat: 45, lon: 8.6 }]);
    if (u.includes('/stoptimes')) return json(w, { stopTimes: [] });
    return json(w, []);
  });
  w.eval(`openTrain('10059')`);
  assert.ok(await until(() => d.querySelector('#tout .tl')));
  const li = d.querySelectorAll('#tout .tl li');
  assert.ok(!/\+/.test(li[0].textContent), '20 secondi dopo: stesso minuto, nessun +1′');
  assert.ok(!/\+/.test(li[1].querySelector('.tt').children[2].textContent), 'arrivo 50 s dopo: stesso minuto');
  assert.match(li[1].textContent, /\+2′/); assert.ok(li[1].querySelector('b.late'));
  assert.ok(d.getElementById('trrec'), 'pulsante registra i ritardi');
  li[1].querySelector('.stlink').click();
  assert.ok(await until(() => !d.getElementById('tab-station').hidden && w.eval('stSel && stSel.id') === 'it-valenza'));
  assert.equal(w.eval('stSel.vt'), 'S00002', 'il codice ViaggiaTreno passa al tabellone');
});
await test('registrazioni: chiave richiesta, gestore vede il modulo, lettore no', async () => {
  let role = 'gestore'; const posts = [];
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('a=rec_list')) { const k = new URLSearchParams(o.body).get('k'); posts.push(k);
      return k === 'giusta-123456' ? json(w, { ok: true, me: { name: 'Andrea', role }, recs: [{ id: 1, kind: 'station', label: 'Abbiategrasso', start: '2026-11-27', end: '2026-12-26', dirs: 'dep,arr', n: 10, nfinal: 8, status: 'in corso', last_run: Date.now() / 1000, created_by: 'Andrea' }] })
        : json(w, { ok: false, error: 'Chiave delle registrazioni errata' }, 403); }
    return json(w, []);
  });
  d.getElementById('recOpen').click(); await sleep(20);
  assert.ok(!d.getElementById('recKeyCard').hidden && d.getElementById('recBody').hidden, 'senza chiave si chiede la chiave');
  d.getElementById('recKey').value = 'sbagliata'; d.getElementById('recKeySave').click();
  assert.ok(await until(() => /errata/.test(d.getElementById('recKeyMsg').textContent)));
  d.getElementById('recKey').value = 'giusta-123456'; d.getElementById('recKeySave').click();
  assert.ok(await until(() => d.querySelector('#recList .rec')));
  assert.ok(!d.getElementById('recForm').hidden); assert.ok(d.querySelector('[data-rdel]'));
  assert.ok(!posts.some(k => k && w.location.href.includes(k)), 'la chiave non va negli indirizzi');
  role = 'lettore'; d.getElementById('recReload').click();
  assert.ok(await until(() => d.getElementById('recForm').hidden));
  assert.ok(!d.querySelector('[data-rdel]'), 'il lettore non può eliminare'); assert.ok(d.querySelector('[data-pdf]'));
  assert.match(d.getElementById('recWho').textContent, /sola lettura/);
});
await test('registrazioni: nuova registrazione di un treno aperto dalla scheda Treni', async () => {
  let added = null;
  const { w, d } = await boot((u, o, w) => {
    if (u.includes('a=rec_add')) { added = Object.fromEntries(new URLSearchParams(o.body)); return json(w, { ok: true, id: 3 }); }
    if (u.includes('a=rec_list')) return json(w, { ok: true, me: { name: 'Andrea', role: 'gestore' }, recs: [] });
    return json(w, []);
  });
  w.localStorage.setItem('intervia.reckey', JSON.stringify('giusta-123456'));
  w.eval(`openRec({kind:'train', code:'10062', origin:'S01820', label:'REG 10062 · Milano Rogoredo → Mortara'})`);
  assert.ok(!d.getElementById('recTrBox').hidden);
  d.querySelector('#recQuick [data-d="7"]').click();
  d.getElementById('recForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.ok(await until(() => added));
  assert.equal(added.kind, 'train'); assert.equal(added.code, '10062'); assert.equal(added.origin, 'S01820'); assert.equal(added.k, 'giusta-123456');
  assert.equal((Date.parse(added.end) - Date.parse(added.start)) / 86400e3, 6, 'una settimana = 7 giorni');
});

await test('registrazione appena creata: nessun avviso di raccolta ferma; avviso dopo 40 minuti', async () => {
  const now = Date.now() / 1000;
  const { w, d } = await boot((u, o, w) => u.includes('a=rec_list') ? json(w, { ok: true, me: { name: 'Andrea', role: 'gestore' }, recs: [
    { id: 1, kind: 'train', label: 'Treno 2030', start: '2026-11-27', end: '2026-12-26', n: 0, nfinal: 0, status: 'in corso', last_run: null, created: now - 60 },
    { id: 2, kind: 'train', label: 'Treno 2031', start: '2026-11-27', end: '2026-12-26', n: 0, nfinal: 0, status: 'in corso', last_run: null, created: now - 3600 }] }) : json(w, []));
  w.localStorage.setItem('intervia.reckey', JSON.stringify('giusta-123456'));
  w.eval('openRec()');
  assert.ok(await until(() => d.querySelectorAll('#recList .rec').length === 2));
  const [a, b] = d.querySelectorAll('#recList .rec');
  assert.ok(!/non gira/.test(a.textContent)); assert.match(a.textContent, /prima raccolta/);
  assert.match(b.textContent, /non gira da più di 40 minuti/);
  assert.ok(a.querySelector('[data-pdf]').disabled, 'senza dati il PDF non si può chiedere');
});
console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
