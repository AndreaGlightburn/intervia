# Intervia

Trova tutte le soluzioni per spostarti da A a B con i mezzi pubblici: treni, bus, metro, tram e traghetti.

- Ricerca di stazioni, fermate e indirizzi, oppure partenza dalla posizione attuale
- Data e ora di partenza o di arrivo
- Solo diretti oppure numero massimo di cambi
- Filtro per tipo di mezzo
- Orari, binari, ritardi in tempo reale (dove disponibili) e link per l'acquisto dei biglietti

App web installabile (PWA), un solo file HTML, nessun server.

Dati orari e percorsi: [Transitous](https://transitous.org) (servizio comunitario basato su dati GTFS aperti e OpenStreetMap).

## Struttura
- `index.html` – l'app
- `manifest.webmanifest`, `sw.js` – installazione e funzionamento offline dell'interfaccia
- `icons/` – logo e icone in SVG
