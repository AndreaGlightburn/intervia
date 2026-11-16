# Ponte dati di Intervia (api.php)

Serve alle schede **Treni** e **Avvisi**: legge ViaggiaTreno, l'infomobilità RFI e il calendario scioperi del MIT, che non si possono leggere direttamente dal browser.

## Installazione su Aruba
1. Con il File Manager di Aruba (o FTP) crea la cartella `intervia` nella radice del sito `www.iz2oii.eu`.
2. Carica dentro il file `api.php`.
3. Apri https://www.iz2oii.eu/intervia/api.php?a=ping — deve comparire `{"ok":true,...}`.

Indirizzo diverso? Cambialo nell'app: **Avvisi → ⚙️ Server dati**.

## Note
- Risponde solo alle azioni previste (non è un proxy aperto) e solo ai siti elencati in `$ALLOWED`.
- Tiene una piccola cache nella cartella temporanea del server per non interrogare troppo spesso le fonti.
- ViaggiaTreno è un servizio non ufficiale: se cambia formato, la scheda Treni va aggiornata.
