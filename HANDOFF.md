# HANDOFF — Intervia

## 0. RIPARTENZA — leggere per primo

**Stato pubblicato (27/11/2026):** `main` = **v2.6.0**, online su https://andreaglightburn.github.io/intervia/ · server `server/api.php` **v2.1.0** nel repo: **da caricare a mano su Aruba** insieme a `config.php` (da `config.example.php`, mai nel repo) e da attivare la raccolta su cron-job.org (istruzioni in `server/LEGGIMI.md`). Finché il server non è aggiornato l'app funziona come prima (tabellone senza ritardi ViaggiaTreno, registrazioni con messaggio d'errore).

**Regole del progetto:** l'app resta un file unico `index.html` (PWA, nessun passaggio di build). Il server PHP sta in `server/` e si carica a mano su Aruba. Niente dati inventati, etichette oneste. A ogni rilascio si alzano insieme `APP_VERSION` (index.html), `VERSION` (sw.js) e `version.json`. Test: `cd tests && npm i && node unit.test.mjs && node smoke.test.mjs`. Push: `git -c push.negotiate=true push origin HEAD:main`. Autore nell'app: "Pony10". Il nome "Intervia" resta provvisorio ("sul nome torneremo").

### 0.1 Redesign 2.5.0 — FATTO
Grafica ispirata (non copiata) a un'app treni di riferimento: leggibilità, spazi, carattere, pagina Informazioni a elenco. Colori e marchio restano i nostri.
- `showTab` aggiorna `#pageTitle` e `aria-current`.
- `#onlyDirect`: forza maxTransfers=0, nasconde `#maxTrow`, salvato in `intervia.prefs.onlyDirect`; la scelta dei cambi resta salvata a parte.
- Elenchi comuni `liRows/liSection/bindList/armTwice`: recenti percorso (`#recenthead`, `#recentClear` a doppio tocco), stazioni, treni, città e preferiti come righe `.li` con cestino `[data-del]`. Gli elenchi stanno **sotto** i risultati (`#stout`, `#tout`).
- Tema: `localStorage['intervia.theme']` ("", light, dark), script in testa contro il lampo, `applyTheme()`, `#themeSeg`. "Cancella i dati" riporta il tema a Sistema.
- Tabellone: `boardRow()` → `.brow` (orario atteso, destinazione, binario evidenziato se cambiato, "+N′"/"in orario"/"programmato" se senza tempo reale, "previsto HH:MM" → risolve **M5**), riga intera tocca → segui la corsa, preferito e aggiorna come icone. Scorrimento mantenuto negli aggiornamenti automatici (A2).
- Treno: banner di stato (Soppresso / Non ancora partito / In viaggio / Arrivato + ritardo), scheda `.tsum`, linea del tempo `.tl` con Arr./Part., binari (`.tk.chg` se cambiato). `openTrip` aggiunge orari stimati futuri (`arrExp/depExp`, mostrati con "≈").
- "Orari da" in Stazioni e Linee con le stesse pillole data/ora del Percorso; Server dati spostato in Informazioni (anche nei messaggi di errore).
- Test: 25 unitari + 31 di interfaccia; nuovi test per pageTitle, onlyDirect, tema, recenti, tabellone, treno; A5 ora controlla anche `:root[data-theme=dark]` e i testi secondari.

**Ancora da fare dal report (prossimo rilascio):** M2 Leaflet in locale, M4 timeout 3 s nel service worker, M8 errori comprensibili, M9 e C1–C5 accessibilità (focus trap nella pagina Informazioni), B4 data sulle schede. Controllo manuale da telefono della checklist §3.

### 0.2 Rilascio 2.6.0 — FATTO (richieste dell'utente con screenshot)
- **Tabellone con ritardi dei treni:** `api.php?a=board` (nome fermata → codice ViaggiaTreno con `vt_station_by_name`, solo corrispondenze sicure; una fermata bus come "Abbiategrasso Piazza Marconi" NON si aggancia). L'app (`stRow`, `mergeVt`, `boardRow`, `paintBoard`) unisce per numero di treno ritardo, binario e soppressione, e aggiunge i treni presenti solo in ViaggiaTreno (Transitous a volte non ha corse di oggi: caso 12:50 → 16:53 segnalato dall'utente). "non ancora partito" quando ViaggiaTreno non ha il ritardo. Prima disegna con Transitous, poi ridisegna con ViaggiaTreno.
- **Treno:** ritardi in rosso (`.late` ora è `--bad`), banner rosso se in ritardo; il "+N′" è la differenza fra gli orari mostrati (niente "06:35 +1′" accanto a 06:35 previsto); ogni fermata è un pulsante `.stlink` → `openStationByName` apre il tabellone (codice ViaggiaTreno passato come `stSel.vt`).
- **Registrazioni ritardi:** server SQLite (`recs`, `obs`) in `cache/rec/ritardi.sqlite`; azioni POST `rec_list/rec_add/rec_del/rec_data`, `collect` da cron-job.org. Chiavi per persona in `config.php` con ruoli `gestori`, `lettori`, `cron` (richiesta dell'utente: "solo io o chi dico io"). Stazione: tabellone (provvisorio) + andamento del treno dopo il passaggio (orario reale, definitivo); dopo 6 h resta il dato del tabellone (`src`). Treno: andamento ogni giro, oggi e ieri.
- App: pagina `#recModal` (Treni → Registrazioni ritardi; anche icona grafico nel tabellone e "Registra i ritardi" nel treno), periodo con scorciatoie 1 settimana / 1 mese / 3 mesi, CSV (`recCsv`, ";" e BOM per Excel) e PDF (`recPdf` con jsPDF + autotable da unpkg, caricati solo al momento; grafici su canvas). Statistiche in `recStats` (puntuale ≤ 5′, anticipi = 0, solo dati definitivi).
- Test: 30 unitari, 35 di interfaccia; prova del server PHP con risposte ViaggiaTreno messe nella cache (vedi cronologia della sessione), PDF generati davvero in Chrome con un mese di dati sintetici.

**Da fare dopo:** verificare con dati veri i nomi stazione Transitous ↔ ViaggiaTreno (Ferrovienord: Cadorna, Saronno); eventuale avviso nell'app a fine registrazione; punti aperti del report (M2 Leaflet in locale, M4, M8, M9, C1–C5, B4).

---

## Storico: revisione correttezza e affidabilità (16/11)

**Data:** 16/11/2026 · **Base:** commit `9b96d90` · **Rilascio:** vedi commit successivo su `main`
**Repository:** https://github.com/AndreaGlightburn/intervia · **App:** https://andreaglightburn.github.io/intervia/
**Server PHP:** `server/api.php` → da caricare su `https://www.iz2oii.eu/intervia/api.php` (versione **2.0.4**)

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
| 7 | Server: nessun limite per IP, cache senza tetto, richieste identiche simultanee duplicate, origine `null` ammessa, `display_errors` non forzato | `server/api.php` | **confermato** | Abuso, carico su Overpass, crescita disco | P1 | Limite 90 richieste/min per IP (12/min per elenchi città e diagnostica, 40/min per linee), IPv6 per /64, IP salvato solo come hash; `flock` per richieste identiche; pulizia periodica (rate 5 min, cache temporanea 2 gg, OSM 180 gg / max 3000 file); `null` rimosso; `display_errors=0`; cURL limitato a http/https |
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
11. Server: `api.php?a=ping` → `"version":"2.0.4"`; `api.php?a=diag` → stato delle fonti.

## 4. Problemi aperti
- **Rilascio 2.4.1 (dal report di collaudo del 16/11)**: corretti A1 orario che invecchia (+ pulsante "Adesso"), A2 tabellone che saltava in cima, A3 "La mia posizione" nelle recenti (ora senza coordinate, GPS riletto), A4 scorrimento ai risultati, A5 contrasto nel tema scuro e chiaro, M1 cancellazione con conferma, M3 cache del service worker, M7 input non validi; inoltre B11 (ViaggiaTreno in https) e S1 (limiti documentati allineati al codice). Ciascuno ha un test. Restano i punti dei rilasci 2.5.0 e 2.6.0 del report.
- **Linee da Transitous (v2.2.0)**: l'elenco delle linee di una città e la ricerca di una linea ora si ricavano dagli orari (`map/stops` + `stoptimes` + `trip`), perché Overpass non risponde al server Aruba (IP condiviso: probabile limite per IP di Overpass, diagnostica 16/11 08:24). Il formato di `map/stops` non è ancora verificato sul servizio reale. Le linee senza corse nelle ore successive non compaiono. OpenStreetMap resta come ripiego.
- **Validazione su dati reali** dei punti 1, 2, 3 e 5 della checklist.
- **ViaggiaTreno dal server Aruba** risultava non raggiungibile: controllare `a=diag`.
- **Copertura metro/ATM** in Transitous non verificata.
- **Parametri `maxPreTransitTime`/`maxPostTransitTime`**: se il servizio li rifiuta (400) vengono tolti automaticamente e la camminata torna al valore predefinito (circa 15 min).
- **Utenti con preferenze salvate prima di questa versione**: il chip "Altri" parte spento, quindi funicolari e funivie restano escluse finché non lo attivano.

## 5. Deploy e rollback
**GitHub Pages:** già pubblicato con il push su `main`. Rollback: `git revert <commit>` e push, oppure ripubblicare `index.html` e `sw.js` del commit `9b96d90`.
**Server PHP (manuale):** sostituire `/intervia/api.php` sul sito con `server/api.php`. La cartella `cache/` si crea da sola; se l'hosting non la consente, si usa la cartella temporanea. Rollback: ricaricare la versione 1.5 (commit `9b96d90`, `server/api.php`). Nessuna variabile di configurazione o segreto richiesto; per altri domini aggiungere l'origine in `$ALLOWED`.
