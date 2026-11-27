// Test automatici delle funzioni "pure" di Intervia (nessuna rete).
// Esecuzione:  node tests/unit.test.mjs
// Estrae le funzioni direttamente da index.html, così si prova il codice pubblicato.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// lo script principale è il più lungo (in testa c'è quello breve che applica il tema)
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];

// estrae una dichiarazione (function, class o const) bilanciando parentesi e ignorando le stringhe
function grab(name) {
  const re = new RegExp(`(^|\\n)((async )?function ${name}\\(|const ${name} =|class ${name}\\b)`);
  const m = re.exec(js);
  if (!m) throw new Error('non trovata: ' + name);
  const start = m.index + m[1].length, isConst = m[2].startsWith('const');
  let depth = 0, q = null, body = false;
  for (let i = start; i < js.length; i++) {
    const c = js[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && js[i + 1] === '/') { i = js.indexOf('\n', i); continue; }
    if (c === '(' || c === '[' || c === '{') { if (c === '{' && depth === 0) body = true; depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (!isConst && body && depth === 0 && c === '}') return js.slice(start, i + 1);
      continue;
    }
    if (isConst && depth === 0 && c === ';') return js.slice(start, i + 1);
  }
  throw new Error('non chiusa: ' + name);
}

const names = ['RAIL', 'modeGroup', 'apiModes', 'TICKETS', 'ticketLinks', 'TZ', 'romeDay', 'tzOffsetMin', 'romeISO',
  'COORD_RE', 'kmBetween', 'shiftLeg', 'applySnap', 'filterIt', 'walkMeters', 'transferMargins', 'nTransit', 'SORTS',
  'parseLineQuery', 'decodePolyline', 'delayMin', 'ERR_MSG', 'NetError', 'fetchT', 'httpKind', 'OPTIONAL_PARAMS',
  'fmtT', 'titleCase', 'dmy', 'hm', 'SRC_TXT', 'recCsv', 'recStats', 'DELAY_BINS', 'delayHistogram', 'groupBy', 'tripsByDay', 'mergeVt', 'pt'];
const ctx = { console, URLSearchParams, Intl, Date, Math, AbortController, DOMException, setTimeout, clearTimeout, last: null, stArr: false };
vm.createContext(ctx);
for (const n of names) vm.runInContext(grab(n).replace(/^const /, 'var ').replace(/^class (\w+)/, 'var $1 = class $1'), ctx);

let passed = 0, failed = 0;
async function test(title, fn) {
  try { await fn(); passed++; console.log('  ✔', title); }
  catch (e) { failed++; console.log('  ✘', title, '\n     ', e.message); }
}
const V = 'v5';
const leg = (mode, s, e, extra = {}) => ({ mode, startTime: s, endTime: e, duration: (Date.parse(e) - Date.parse(s)) / 1000,
  from: { name: 'A', lat: 45.4, lon: 8.9, departure: s }, to: { name: 'B', lat: 45.46, lon: 9.18, arrival: e }, ...extra });
const T = h => `2026-11-16T${h}:00Z`;

console.log('Filtri dei mezzi');
await test('tram escluso: nessun risultato con il tram', () => {
  ctx.last = { groups: ['treno', 'bus', 'metro'], maxT: '' };
  const its = [
    { legs: [leg('REGIONAL_RAIL', T('07:00'), T('07:30'))] },
    { legs: [leg('TRAM', T('07:00'), T('07:20'))] },
    { legs: [leg('BUS', T('07:00'), T('07:10')), leg('TRAM', T('07:15'), T('07:30'))] },
  ];
  const r = ctx.filterIt(its, V);
  assert.equal(r.its.length, 1); assert.equal(r.excluded, 2);
  assert.ok(r.its.every(it => it.legs.every(l => l.mode !== 'TRAM')));
});
await test('funicolari/mezzi non classificati esclusi se "Altri" non è selezionato', () => {
  ctx.last = { groups: ['treno'], maxT: '' };
  const r = ctx.filterIt([{ legs: [leg('FUNICULAR', T('07:00'), T('07:05'))] }, { legs: [leg('MISTERO', T('07:00'), T('07:05'))] }], V);
  assert.equal(r.its.length, 0);
  ctx.last = { groups: ['treno', 'altro'], maxT: '' };
  assert.equal(ctx.filterIt([{ legs: [leg('FUNICULAR', T('07:00'), T('07:05'))] }], V).its.length, 1);
});
await test('i tratti a piedi non violano i filtri; solo-a-piedi non è un risultato con mezzi', () => {
  ctx.last = { groups: ['bus'], maxT: '' };
  const r = ctx.filterIt([{ legs: [leg('WALK', T('07:00'), T('07:05')), leg('BUS', T('07:06'), T('07:20'))] }, { legs: [leg('WALK', T('07:00'), T('07:30'))] }], V);
  assert.equal(r.its.length, 1);
});
await test('limite cambi rispettato', () => {
  ctx.last = { groups: ['bus', 'treno'], maxT: '0' };
  const r = ctx.filterIt([{ legs: [leg('BUS', T('07:00'), T('07:10')), leg('REGIONAL_RAIL', T('07:15'), T('07:40'))] }], V);
  assert.equal(r.its.length, 0); assert.equal(r.excluded, 1);
});
await test('apiModes: "Altri" aggiunge funicolari solo se scelto', () => {
  assert.ok(!ctx.apiModes(['treno'], V).includes('FUNICULAR'));
  assert.ok(ctx.apiModes(['treno', 'altro'], V).includes('FUNICULAR'));
});
await test('callPlan non toglie mai il filtro dei mezzi fra i parametri facoltativi', () => {
  assert.ok(!ctx.OPTIONAL_PARAMS.includes('transitModes'));
  assert.ok(!/TRANSIT'/.test(grab('callPlan')), 'nessun ripiego su TRANSIT generico');
});

console.log('Porta a porta (fallback fermata più vicina)');
const walkLegs = (min, m) => [{ mode: 'WALK', startTime: T('00:00'), endTime: new Date(Date.parse(T('00:00')) + min * 60000).toISOString(), duration: min * 60, distance: m,
  from: { name: 'Indirizzo' }, to: { name: 'Fermata' } }];
await test('tratto a piedi iniziale e finale aggiunti e inclusi nella durata', () => {
  const it = { legs: [leg('BUS', T('07:10'), T('07:40'))], startTime: T('07:10'), endTime: T('07:40'), duration: 1800 };
  const snap = { from: { walk: { duration: 480, distance: 600, legs: walkLegs(8, 600) }, stop: { name: 'F1' }, point: { name: 'Via X' } },
                 to: { walk: { duration: 300, distance: 350, legs: walkLegs(5, 350) }, stop: { name: 'F2' }, point: { name: 'Via Y' } } };
  const r = ctx.applySnap(it, snap);
  assert.equal(r.legs.length, 3);
  assert.equal(r.startTime, new Date(Date.parse(T('07:10')) - 8 * 60000).toISOString());
  assert.equal(r.endTime, new Date(Date.parse(T('07:40')) + 5 * 60000).toISOString());
  assert.equal(r.duration, 1800 + 480 + 300);
  assert.equal(r._incomplete, false);
  assert.equal(ctx.walkMeters(r, V), 950);
});
await test('tratto a piedi non calcolabile: segnalato, non inventato', () => {
  const it = { legs: [leg('BUS', T('07:10'), T('07:40'))], startTime: T('07:10'), endTime: T('07:40'), duration: 1800 };
  const r = ctx.applySnap(it, { from: { walk: null, stop: { name: 'F1', lat: 1, lon: 1 }, point: { name: 'Via X', lat: 1, lon: 1 } } });
  assert.equal(r._incomplete, true);
  assert.equal(r.legs[0]._missing, true);
  assert.equal(r.legs[0].duration, 0);
  assert.equal(ctx.walkMeters(r, V), null, 'cammino non disponibile, non zero');
});

console.log('Coincidenze e ordinamenti');
await test('margine di coincidenza al netto del cammino', () => {
  const it = { legs: [leg('REGIONAL_RAIL', T('07:00'), T('07:30')), leg('WALK', T('07:30'), T('07:34')), leg('SUBWAY', T('07:36'), T('07:50'))] };
  const m = ctx.transferMargins(it, V);
  assert.equal(m.length, 1); assert.equal(m[0].min, 2);
});
await test('ordinamento "meno cammino" mette in fondo i casi non calcolabili', () => {
  const a = { duration: 100, startTime: T('07:00'), legs: [leg('WALK', T('07:00'), T('07:05'), { distance: 400 }), leg('BUS', T('07:05'), T('07:20'))] };
  const b = { duration: 90, startTime: T('07:00'), legs: [leg('WALK', T('07:00'), T('07:05'), { _missing: true }), leg('BUS', T('07:05'), T('07:20'))] };
  const c = { duration: 95, startTime: T('07:00'), legs: [leg('WALK', T('07:00'), T('07:05'), { distance: 100 }), leg('BUS', T('07:05'), T('07:20'))] };
  const s = [a, b, c].sort((x, y) => ctx.SORTS.walk[1](x, y, V));
  assert.deepEqual(s.map(x => x.duration), [95, 100, 90]);
});

console.log('Orari (fuso Europe/Rome)');
await test('ora solare: 16/11 07:30 Roma = 06:30 UTC', () => assert.equal(ctx.romeISO('2026-11-16', '07:30'), '2026-11-16T06:30:00.000Z'));
await test('ora legale: 15/07 07:30 Roma = 05:30 UTC', () => assert.equal(ctx.romeISO('2026-07-15', '07:30'), '2026-07-15T05:30:00.000Z'));
await test('cambio ora (29/03/2026 03:30 Roma = 01:30 UTC)', () => assert.equal(ctx.romeISO('2026-03-29', '03:30'), '2026-03-29T01:30:00.000Z'));
await test('dopo mezzanotte: giorno di arrivo diverso riconosciuto', () => assert.notEqual(ctx.romeDay('2026-11-16T22:50:00Z'), ctx.romeDay('2026-11-16T23:10:00Z')));

console.log('Biglietti');
await test('nessuna promessa di acquisto diretto', () => {
  for (const ag of ['Trenitalia', 'Trenord', 'ATM', 'Sconosciuta Srl']) {
    const t = ctx.ticketLinks({ agencyName: ag });
    assert.ok(t.length && t.every(x => !/^Biglietto|Acquista|Compra/i.test(x.label)), ag + ': ' + JSON.stringify(t));
  }
});

console.log('Ricerca linee');
await test('"Metro 4 milano" → M4 metro a Milano', () => {
  const r = ctx.parseLineQuery('Metro 4 milano');
  assert.equal(r.label, 'M4'); assert.equal(r.place, 'milano'); assert.ok(r.modes.includes('subway'));
});
await test('"passante 5" → S5', () => assert.equal(ctx.parseLineQuery('passante 5').label, 'S5'));
await test('decodifica polilinea (esempio Google)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5))), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

console.log('Richieste di rete');
await test('fetchT interrompe davvero la richiesta allo scadere (AbortController)', async () => {
  let aborted = false;
  ctx.fetch = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => { aborted = true; rej(new DOMException('a', 'AbortError')); }));
  await assert.rejects(ctx.fetchT('x', {}, 50), e => e.kind === 'timeout');
  assert.ok(aborted, 'la fetch sottostante è stata annullata');
});
await test('fetchT: annullamento esterno (ricerca superata) propagato come AbortError', async () => {
  ctx.fetch = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))));
  const c = new AbortController(); const p = ctx.fetchT('x', { signal: c.signal }, 5000); c.abort();
  await assert.rejects(p, e => e.name === 'AbortError');
});
await test('fetchT: errore di rete distinto dal timeout', async () => {
  ctx.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(ctx.fetchT('x', {}, 5000), e => e.kind === 'network');
});
await test('codici HTTP classificati', () => {
  assert.equal(ctx.httpKind(429), 'busy'); assert.equal(ctx.httpKind(503), 'unavailable'); assert.equal(ctx.httpKind(400), 'bad');
});

console.log('Rilascio 2.4.1');
await test('M7: "???" non è un nome di linea', () => { assert.equal(ctx.parseLineQuery('???'), null); assert.ok(ctx.parseLineQuery('S9')); });
await test('A5: contrasto ≥ 4,5:1 nel tema chiaro e scuro', () => {
  const lum = h => { const c = h.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const dark = css.match(/:root\[data-theme=dark\]\{([^}]*)\}/)[1];
  const auto = css.match(/prefers-color-scheme:dark\)\{:root:not\(\[data-theme=light\]\)\{([^}]*)\}/)[1];
  assert.equal(auto, dark, 'scuro automatico e scuro forzato hanno gli stessi colori');
  const v = (block, k) => block.match(new RegExp('--' + k + ':(#[0-9a-fA-F]{6})'))[1];
  const light = css.match(/:root\{([^}]*)\}/)[1];
  assert.ok(ratio('#ffffff', v(dark, 'pri')) >= 4.5, 'pulsanti scuri');
  assert.ok(ratio(v(dark, 'link'), v(dark, 'card')) >= 4.5 && ratio(v(dark, 'link'), v(dark, 'pri2')) >= 4.5, 'link scuri');
  assert.ok(ratio(v(light, 'link'), v(light, 'pri2')) >= 4.5 && ratio(v(light, 'mute'), v(light, 'bg')) >= 4.5 && ratio(v(dark, 'mute'), v(dark, 'card')) >= 4.5, 'testi secondari');
  assert.ok(ratio(v(light, 'link'), '#e8f0f9') >= 4.5 && ratio(v(light, 'link'), '#ffffff') >= 4.5, 'link chiari');
  assert.ok(/a\{color:var\(--link\)\}/.test(css), 'i link usano --link');
  assert.ok(/name="color-scheme"/.test(html));
});
await test('M3: il service worker non salva version.json né richieste con parametri', async () => {
  const swSrc = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const puts = [], handlers = {};
  const sctx = { self: { addEventListener: (t, f) => handlers[t] = f, skipWaiting() {}, clients: { claim() {} } }, location: { origin: 'https://x.io' }, URL, Request,
    caches: { open: async () => ({ put: (req) => puts.push(req.url), addAll: async () => {} }), keys: async () => [], match: async () => null },
    fetch: async () => new Response('ok', { status: 200 }) };
  vm.createContext(sctx); vm.runInContext(swSrc, sctx);
  for (const u of ['https://x.io/intervia/version.json?t=1', 'https://x.io/intervia/version.json?t=2', 'https://x.io/intervia/index.html']) {
    let p; handlers.fetch({ request: new Request(u), respondWith: x => p = x }); await p; await new Promise(r => setTimeout(r, 5));
  }
  assert.deepEqual(puts, ['https://x.io/intervia/index.html']);
});

console.log('Rilascio 2.6.0');
const R = (o) => ({ day: '2026-11-27', train: '10062', cat: 'REG', origin: 'MILANO ROGOREDO', dest: 'MORTARA', station: 'ABBIATEGRASSO', station_id: 'S01067', kind: 'dep',
  sched: Date.parse('2026-11-27T07:00:00Z'), real: null, delay: 0, track: '2', track_sched: '1', cancelled: 0, src: 'reale', final: 1, ...o });
await test('statistiche: puntuali entro 5 min, anticipi come 0, soppressi esclusi dalla media, solo dati definitivi', () => {
  const rows = [R({ delay: -2 }), R({ delay: 3 }), R({ delay: 6 }), R({ delay: 20 }), R({ delay: null, cancelled: 1 }), R({ delay: 99, final: 0 })];
  const s = ctx.recStats(rows);
  assert.equal(s.total, 5); assert.equal(s.open, 1); assert.equal(s.cancelled, 1); assert.equal(s.measured, 4);
  assert.equal(s.punctual, 0.5); assert.equal(s.mean, (0 + 3 + 6 + 20) / 4); assert.equal(s.median, 4.5); assert.equal(s.max, 20); assert.equal(s.over15, 1);
  assert.equal(s.p90, 20);
  assert.equal(JSON.stringify(ctx.delayHistogram(rows).map(h => h[1])), '[1,1,1,0,1,0,0]');
  const empty = ctx.recStats([]); assert.equal(empty.mean, null); assert.equal(empty.punctual, null);
});
await test('treno: un viaggio al giorno, partenza dalla prima fermata e arrivo all\'ultima', () => {
  const t = h => Date.parse(`2026-11-27T${h}:00Z`);
  const trips = ctx.tripsByDay([R({ kind: 'dep', sched: t('06:00'), delay: 1, station: 'A' }), R({ kind: 'arr', sched: t('06:30'), delay: 4, station: 'B' }), R({ kind: 'dep', sched: t('06:31'), delay: 4, station: 'B' }), R({ kind: 'arr', sched: t('07:00'), delay: 9, station: 'C' }),
    R({ day: '2026-11-28', kind: 'dep', sched: t('06:00'), cancelled: 1, delay: null }), R({ day: '2026-11-28', kind: 'arr', sched: t('07:00'), cancelled: 1, delay: null })]);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].dep.station, 'A'); assert.equal(trips[0].arr.station, 'C'); assert.equal(trips[0].arr.delay, 9);
  assert.equal(trips[1].cancelled, true);
});
await test('CSV: separatore ";", BOM per Excel, campi con ";" tra virgolette, orari italiani', () => {
  const csv = ctx.recCsv([R({ real: Date.parse('2026-11-27T07:06:00Z'), delay: 6, dest: 'MORTARA; VIA VIGEVANO' })]);
  assert.ok(csv.startsWith('﻿Data;Treno;'));
  const line = csv.split('\r\n')[1];
  assert.match(line, /^27\/11\/2026;10062;REG;Milano Rogoredo;"Mortara; Via Vigevano";Abbiategrasso;S01067;partenza;08:00;08:06;6;2;1;no;orario reale;sì$/);
});
await test('tabellone: ritardi ViaggiaTreno uniti per numero, treni mancanti aggiunti, "non ancora partito" onesto', () => {
  const base = Date.parse('2026-11-27T11:00:00Z');
  const rows = [{ g: 'treno', line: 'R31', num: '10062', head: 'Mortara', sched: base, exp: base, delay: null, track: null },
                { g: 'bus', line: '50', num: null, head: 'X', sched: base + 60e3, exp: base + 60e3, delay: null }];
  const vt = [{ n: '10062', delay: 7, sched: base, track: '3', trackSched: '2', cancelled: false },
              { n: '10055', cat: 'REG', delay: null, sched: base + 1800e3, dest: 'MILANO ROGOREDO', client: 'Trenord', cancelled: false, o: 'S00249', d: 1 },
              { n: '9999', delay: 0, sched: base - 3 * 3600e3, cancelled: false }];
  const m = ctx.mergeVt(rows, vt, base);
  assert.equal(m.length, 3, 'il treno di 3 ore prima non si aggiunge');
  assert.equal(m[0].delay, 7); assert.equal(m[0].exp, base + 7 * 60e3); assert.equal(m[0].track, '3'); assert.equal(m[0].trackSched, '2');
  const added = m.find(r => r.num === '10055');
  assert.ok(added.vtOnly); assert.equal(added.head, 'Milano Rogoredo'); assert.equal(added.notStarted, true); assert.equal(added.delay, null);
  assert.equal(ctx.mergeVt(rows, null), rows);
});
await test('testi del PDF: niente caratteri che i font standard non sanno scrivere', () => {
  assert.equal(ctx.pt('Milano → Mortara +3′ ≈ 5 – fine…'), "Milano - Mortara +3' ~ 5 - fine...");
  assert.equal(ctx.pt('Città perché'), 'Città perché');
});

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
