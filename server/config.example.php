<?php
// Intervia – chiavi delle registrazioni dei ritardi.
// Copia questo file come config.php nella stessa cartella di api.php e cambia TUTTE le chiavi
// (almeno 12 caratteri, meglio 20+ lettere e numeri a caso). config.php non va mai pubblicato su GitHub.
return [
    // possono creare ed eliminare registrazioni (e scaricare tutto)
    'gestori' => [
        'Andrea' => 'cambia-questa-chiave-1',
        // 'Mario' => 'unaltra-chiave-solo-sua',
    ],
    // possono solo vedere l'elenco e scaricare report e dati grezzi
    'lettori' => [
        // 'Luca' => 'chiave-di-luca',
    ],
    // usata solo da cron-job.org nell'indirizzo della raccolta automatica
    'cron' => 'cambia-anche-questa-chiave-cron',
];
