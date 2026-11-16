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

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
