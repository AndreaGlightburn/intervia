# Intervia

Trova le soluzioni per spostarti da A a B con i mezzi pubblici (treni, bus, metro, tram, traghetti) e consulta tabelloni, treni, linee e avvisi.

App web installabile (PWA) pubblicata su GitHub Pages: https://andreaglightburn.github.io/intervia/

## Funzioni
- **Percorso**: ricerca da indirizzo, fermata o punto sulla mappa; partenza o arrivo a un orario; numero massimo di cambi; scelta dei mezzi. Le soluzioni si possono ordinare per partenza, velocità, meno cambi o meno cammino. Per ogni soluzione si vedono tratti a piedi, coincidenze strette, ritardi in tempo reale, mappa del tragitto e fermate intermedie, più il link al sito dell'operatore (nessun acquisto diretto precompilato).
- **Stazioni**: tabellone partenze/arrivi con ritardi e binari; da ogni corsa si apre la vista "segui la corsa".
- **Treni**: ricerca per numero (ViaggiaTreno, tramite il server PHP) e vista della singola corsa.
- **Linee**: ricerca di una linea (es. "S9", "M4 Milano") ed elenco di tutte le linee di un comune, con fermate e mappa.
- **Avvisi**: infomobilità RFI e scioperi del Ministero dei Trasporti (tramite il server PHP).
- Preferiti per linee, treni e stazioni; dati statici delle linee conservati sul telefono.

## Architettura
| Parte | Dove | Ruolo |
|---|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | GitHub Pages | L'app (un solo file HTML, nessuna build) |
| `server/api.php` | Hosting PHP esterno (es. Aruba, `https://www.iz2oii.eu/intervia/api.php`) | Ponte verso servizi che il browser non può interrogare direttamente |

### Servizi esterni
| Servizio | Usato da | Per |
|---|---|---|
| [Transitous](https://transitous.org) (MOTIS) | browser | percorsi, tratti a piedi, tabelloni, corse, fermate vicine |
| [Photon](https://photon.komoot.io) (OpenStreetMap) | browser | indirizzi, luoghi, confini comunali |
| Tile OpenStreetMap + Leaflet (unpkg) | browser | mappe |
| Overpass API (OpenStreetMap) | server PHP (e browser come riserva) | linee e fermate |
| ViaggiaTreno (non ufficiale) | server PHP | ricerca treno per numero |
| RFI feed RSS infomobilità | server PHP | avvisi |
| MIT calendario scioperi | server PHP | scioperi |

Nessuna chiave API è necessaria o presente nel repository.

## Pubblicazione
- **App**: ogni push su `main` viene pubblicato da GitHub Pages. A ogni rilascio aumentare **insieme** la versione in tre punti: `APP_VERSION` in `index.html`, `VERSION` in `sw.js` e `version.json`. All'avvio (e quando si torna nell'app) l'app legge `version.json` senza cache: se trova una versione più nuova svuota le copie salvate e si ricarica una volta.
- **Server**: caricare `server/api.php` nella cartella `/intervia/` del sito PHP. La cartella `cache/` accanto al file si crea da sola ed è protetta da `.htaccess`. Verifica: `api.php?a=ping`. L'indirizzo del server si cambia nell'app in *Avvisi → ⚙️ Server dati*.

## Test
```
cd tests && npm install && npm test
```
- `unit.test.mjs`: funzioni di filtro, porta a porta, orari, biglietti, richieste (estratte da `index.html`).
- `smoke.test.mjs`: l'app intera in un browser simulato (jsdom) con risposte finte dei servizi.

I test non usano la rete: la qualità dei dati reali va verificata con la checklist in `HANDOFF.md`.
