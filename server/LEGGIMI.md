# Ponte dati di Intervia (api.php)

Serve alle schede **Stazioni** (ritardi e binari dei treni), **Treni** (andamento e registrazioni dei ritardi) e **Avvisi**: legge ViaggiaTreno, l'infomobilità RFI e il calendario scioperi del MIT, che non si possono leggere direttamente dal browser.

## Installazione su Aruba
1. Con il File Manager di Aruba (o FTP) crea la cartella `intervia` nella radice del sito `www.iz2oii.eu`.
2. Carica dentro il file `api.php` (sostituisci quello vecchio).
3. Apri https://www.iz2oii.eu/intervia/api.php?a=ping — deve comparire `{"ok":true,"version":"2.1.1","sqlite":true,...}`.
   Se `sqlite` è `false`, il piano Aruba non ha SQLite: le registrazioni dei ritardi non possono funzionare (il resto sì).

Indirizzo diverso? Cambialo nell'app: **Informazioni → Server dati**.

## Registrazione dei ritardi (versione 2.1)
Solo chi ha una chiave può creare, vedere o eliminare le registrazioni. Le chiavi stanno nel file `config.php`, sul server e **mai su GitHub**.

### 1. Le chiavi (`config.php`)
1. Copia `config.example.php`, rinominalo `config.php` e caricalo nella stessa cartella di `api.php`.
2. Inventa le chiavi: almeno 12 caratteri, meglio 20 o più lettere e numeri a caso (per esempio con un generatore di password). Ogni persona ha la sua:
   - `gestori`: possono creare ed eliminare registrazioni e scaricare tutto;
   - `lettori`: possono solo vedere l'elenco e scaricare report PDF e dati CSV;
   - `cron`: chiave usata solo dalla raccolta automatica (punto 2).
3. Per togliere l'accesso a qualcuno cancella la sua riga; per aggiungerne uno aggiungi una riga. Le registrazioni restano.
4. Nell'app: **Treni → Registrazioni ritardi**, inserisci la tua chiave una volta sola.

### 2. La raccolta automatica (cron-job.org, gratuito)
Il piano base di Aruba non ha lavori pianificati: ci pensa cron-job.org, che "visita" un indirizzo a intervalli regolari.
1. Crea un account su https://cron-job.org.
2. **Create cronjob**:
   - Title: `Intervia raccolta ritardi`
   - URL: `https://www.iz2oii.eu/intervia/api.php?a=collect&k=` seguito dalla chiave `cron` di config.php
   - Execution schedule: **Every 10 minutes** (va bene anche ogni 15)
   - In **Advanced**: Timeout 30 secondi; attiva le notifiche in caso di errore, se vuoi.
3. Salva, poi **Test run**: la risposta deve essere `{"ok":true,"done":[...]}`.
4. Nell'app, sotto ogni registrazione, compare l'ora dell'ultima raccolta. Se resta ferma per più di 40 minuti l'app lo segnala.

### Come funziona
- Ogni giro legge il tabellone ViaggiaTreno delle stazioni registrate (partenze e/o arrivi) e l'andamento dei treni registrati.
- Per ogni treno già passato rilegge l'andamento e salva l'**orario reale** di passaggio in quella stazione (dato definitivo). Se dopo 6 ore l'orario reale manca, resta l'ultimo ritardo letto sul tabellone, segnato come tale nei dati.
- I dati stanno in `intervia/cache/rec/ritardi.sqlite` (la cartella `cache` è protetta da `.htaccess`). Massimo 30 registrazioni, ognuna lunga al massimo un anno.
- Il report si scarica dall'app in qualsiasi momento: durante il periodo è parziale, alla fine è completo.

## Versione 2.0
- Limite di richieste per IP (90/min; 12/min per l'elenco linee di una città e la diagnostica; 40/min per linee e fermate). L'IP non viene salvato in chiaro.
- Richieste identiche simultanee verso OpenStreetMap: ne parte una sola, le altre aspettano il risultato.
- Pulizia automatica della cache (circa 1 richiesta su 100).
- Diagnostica: `api.php?a=diag` mostra se il server raggiunge ViaggiaTreno, RFI e il Ministero.

## Note
- Risponde solo alle azioni previste (non è un proxy aperto) e solo ai siti elencati in `$ALLOWED`.
- ViaggiaTreno è un servizio non ufficiale: se cambia formato, le schede Stazioni e Treni e la raccolta vanno aggiornate.
- Le stazioni solo Ferrovienord (es. Milano Cadorna, Saronno) potrebbero non essere in ViaggiaTreno: lì il tabellone mostra solo gli orari.
