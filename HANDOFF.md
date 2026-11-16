# HANDOFF — Intervia, revisione correttezza e affidabilità

**Data:** 16/11/2026 · **Base:** commit `9b96d90` · **Rilascio:** vedi commit successivo su `main`
**Repository:** https://github.com/AndreaGlightburn/intervia · **App:** https://andreaglightburn.github.io/intervia/
**Server PHP:** `server/api.php` → da caricare su `https://www.iz2oii.eu/intervia/api.php` (versione **2.0.1**)

---

## 1. Audit (Fase A)

| # | Problema | File / funzione | Esito verifica | Impatto | Pr. | Soluzione |
|---|---|---|---|---|---|---|
| 1 | Fallback alla fermata più vicina: sostituiva l'indirizzo con la fermata, il tratto a piedi spariva da orari e durata; scelta in linea d'aria senza distanza massima | `index.html` · `run()`, `snapToStops()`, `nearestStop()` | **confermato** | Itinerari non porta a porta, durate falsamente migliori | P0 | Camminata ammessa portata a 30 min (`maxPre/PostTransitTime`); fallback solo entro 2,5 km e 45 min a piedi; tratto a piedi **calcolato sulle strade** dal servizio e incluso negli orari; se non calcolabile: segnaposto dichiarato, avviso, "cammino n.d." |
| 2 | Su HTTP 400 si ripeteva la ricerca con `TRANSIT` (tutti i mezzi) | `callPlan()` | **confermato** | Vincoli persi lato server (poi filtrati sul telefono) | P0 | Su 400 si tolgono uno alla volta solo i parametri facoltativi; il filtro dei mezzi non viene mai tolto; se non basta: errore chiaro |
| 3 | Mezzi "altro" (funicolari, funivie, non classificati) sempre ammessi | `filterIt()`, `apiModes()` | **confermato** | Risultati contrari alle preferenze | P0 | Nuova scelta esplicita "🚡 Altri"; un solo controllo canonico per ricerca, tentativi e fallback; conteggio e avviso delle soluzioni nascoste |
| 4 | Ricerca percorsi senza timeout; `withTimeout` non annullava la richiesta | `callPlan()`, `withTimeout()` | **confermato** | Attese indefinite, richieste orfane | P1 | `fetchT()` con `AbortController` su tutte le chiamate; `withTimeout` rimosso |
| 5 | Ricerche ravvicinate: la risposta vecchia poteva sovrascrivere la nuova | `run()`, tabellone, linee, città, treni | **confermato** | Risultati fuori ordine | P1 | Numero di sequenza + annullamento della ricerca precedente |
| 6 | Errori non distinti (rete, timeout, servizio, nessun percorso) | vari | **confermato** | Messaggi poco utili | P1 | `NetError` con tipi `timeout/network/busy/unavailable/bad`; "nessuna soluzione" distinto e motivato |
| 7 | Server: nessun limite per IP, cache senza tetto, richieste identiche simultanee duplicate, origine `null` ammessa, `display_errors` non forzato | `server/api.php` | **confermato** | Abuso, carico su Overpass, crescita disco | P1 | Limite 90 richieste/min per IP (6/min per elenchi città, 30/min per linee), IPv6 per /64, IP salvato solo come hash; `flock` per richieste identiche; pulizia periodica (rate 5 min, cache temporanea 2 gg, OSM 180 gg / max 3000 file); `null` rimosso; `display_errors=0`; cURL limitato a http/https |
| 8 | Pulsanti "Biglietto X" aprivano solo la homepage | `ticketLinks()` | **confermato** | Promessa ingannevole | P2 | Etichetta "🌐 Sito X (biglietti)" / "Sito dell'operatore" |
| 9 | Data/ora interpretate nel fuso del telefono | invio ricerca, `fmtT/fmtD` | **confermato** (rilevante solo fuori Italia) | Orari sbagliati all'estero | P2 | `romeISO()` e formattazione in `Europe/Rome`, ora legale gestita; "+1 g" per arrivi il giorno dopo |
| 10 | Mancano ordinamenti e avviso coincidenze | `render()` | miglioramento | — | P2 | Ordina per Partenza / Più veloce / Meno cambi / Meno cammino; avviso coincidenze < 3 min o a rischio, con nota "non garantisce la coincidenza" |
| 11 | Prezzo "stima" sommato da dati tariffari GTFS di copertura incerta | `fareText()` | **parziale** | Possibile prezzo errato | P2 | Prezzo **non più mostrato** (funzione lasciata, inutilizzata) |
| 12 | Logica concentrata in `index.html` (~1800 righe) | — | confermato | Manutenibilità | P3 | **Non modificato** per scelta: l'app resta un file unico (preferenza del progetto, nessuna build). Test che estraggono le funzioni da `index.html` |
| 13 | README non descriveva il server PHP | `README.md` | confermato | Deploy poco chiaro | P3 | README riscritto |

Non coperti dal documento ma noti: ViaggiaTreno è un servizio **non ufficiale**; i parametri di `map/trips` (ricerca linee dagli orari) non sono verificati sul servizio reale; la copertura di ATM/metro nei dati Transitous non è verificata.

## 2. Modifiche (Fase B)

**GitHub Pages:** `index.html`, `sw.js` (cache `intervia-v15`), `README.md`, `HANDOFF.md`, `.gitignore`, `tests/` (nuovi).
**Server PHP:** `server/api.php` (v2.0), `server/LEGGIMI.md`.

Punti principali in `index.html`: `fetchT`, `NetError`, `callPlan` (parametri facoltativi), `run` (sequenza/annullamento), `snapToStops`, `walkBetween`, `applySnap`, `filterIt` (ritorna `{its, excluded}`), `walkMeters`, `transferMargins`, `SORTS`, `paintResults`, `romeISO`, `tzOffsetMin`, `ticketLinks`, chip "Altri".

## 3. Test

| Test | Esito |
|---|---|
| `tests/unit.test.mjs` — 22 casi: filtri (tram escluso, "Altri", cambi, solo-a-piedi), nessun ripiego su `TRANSIT`, porta a porta con e senza cammino calcolabile, margini coincidenza, ordinamento "meno cammino", fuso orario (solare, legale, cambio ora, mezzanotte), biglietti, parsing linee, polilinee, timeout reale, annullamento, errori di rete, codici HTTP | **passato** |
| `tests/smoke.test.mjs` — 10 casi nell'app intera (jsdom, risposte finte): ricerca normale; 400 senza perdere i filtri; mezzo escluso; fallback con cammino calcolato (+orario anticipato); cammino non calcolabile dichiarato; fermata oltre 2,5 km rifiutata; due ricerche ravvicinate; servizio lento → timeout leggibile; arrivo dopo mezzanotte "+1 g"; etichetta biglietti | **passato** |
| PHP in locale (`php -S`): `ping`, CORS ammesso/negato, OPTIONS 204, azione non valida, parametri non validi (treno, linee con iniezione `"]`, id, nome città), limite per IP (429 dopo la soglia), `.htaccess` nella cache | **passato** |
| Chiamate reali a Transitous, Photon, Overpass, ViaggiaTreno, RFI, MIT | **non eseguibile** dall'ambiente di sviluppo (rete esterna bloccata) |
| Aggiornamento PWA installata su telefono | **non eseguibile** qui → checklist |

### Checklist manuale (da telefono, annotare data/ora e risultato)
1. Via Roma Abbiategrasso → via Magenta Milano: tratti a piedi iniziale/finale presenti, durata coerente.
2. Abbiategrasso (stazione) → Milano Centrale; Milano → Torino Porta Nuova: treni plausibili rispetto a Trenord/Trenitalia.
3. Tratta interna a Milano (es. Duomo → Città Studi): compare la metro? (verifica copertura ATM).
4. Escludere Bus: nessuna soluzione con 🚌; compare "N soluzioni nascoste".
5. Indirizzo lontano dalla stazione (es. cascina fuori paese): fallback con avviso e cammino, oppure "nessuna soluzione" motivato.
6. "Arrivo entro" 00:30: orari e "+1 g" coerenti.
7. Lanciare due ricerche di fila cambiando destinazione: resta solo la seconda.
8. Modalità aereo: messaggio "Connessione non riuscita", pulsante di nuovo attivo.
9. Pulsanti "Sito … (biglietti)" aprono il sito dell'operatore.
10. App installata: dopo l'aggiornamento compaiono il chip "🚡 Altri" e gli ordinamenti (se no: chiudere e riaprire).
11. Server: `api.php?a=ping` → `"version":"2.0.1"`; `api.php?a=diag` → stato delle fonti.

## 4. Problemi aperti
- **Validazione su dati reali** dei punti 1, 2, 3 e 5 della checklist.
- **ViaggiaTreno dal server Aruba** risultava non raggiungibile: controllare `a=diag`.
- **Copertura metro/ATM** in Transitous non verificata.
- **Parametri `maxPreTransitTime`/`maxPostTransitTime`**: se il servizio li rifiuta (400) vengono tolti automaticamente e la camminata torna al valore predefinito (circa 15 min).
- **Utenti con preferenze salvate prima di questa versione**: il chip "Altri" parte spento, quindi funicolari e funivie restano escluse finché non lo attivano.

## 5. Deploy e rollback
**GitHub Pages:** già pubblicato con il push su `main`. Rollback: `git revert <commit>` e push, oppure ripubblicare `index.html` e `sw.js` del commit `9b96d90`.
**Server PHP (manuale):** sostituire `/intervia/api.php` sul sito con `server/api.php`. La cartella `cache/` si crea da sola; se l'hosting non la consente, si usa la cartella temporanea. Rollback: ricaricare la versione 1.5 (commit `9b96d90`, `server/api.php`). Nessuna variabile di configurazione o segreto richiesto; per altri domini aggiungere l'origine in `$ALLOWED`.
