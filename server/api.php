<?php
/*
 * Intervia – ponte dati (da caricare su hosting PHP, es. Aruba)
 * Serve all'app per leggere dati che i siti originali non lasciano leggere
 * direttamente dal browser. NON è un proxy aperto: risponde solo alle azioni sotto.
 *
 *   api.php?a=train&n=9660                       ricerca treno per numero (ViaggiaTreno)
 *   api.php?a=train&n=9660&o=S01700&d=1763247600000   andamento del treno scelto
 *   api.php?a=info                               infomobilità RFI (tempo reale + avvisi)
 *   api.php?a=strikes                            scioperi (Ministero dei Trasporti)
 *   api.php?a=board&name=Abbiategrasso&kind=dep  tabellone ViaggiaTreno di una stazione (ritardi, binari)
 *   api.php?a=stsearch&q=abbiat                  stazioni ViaggiaTreno (codice S01xxx)
 *   api.php?a=ping                               verifica funzionamento
 *
 *   Registrazione dei ritardi (richiedono la chiave in config.php, inviata in POST come k=…):
 *   POST a=rec_list | rec_add | rec_del | rec_data          gestione e dati dall'app
 *   api.php?a=collect&k=CHIAVE                    raccolta, da chiamare ogni 10–15 minuti (cron-job.org)
 */

@ini_set('display_errors', '0');
date_default_timezone_set('Europe/Rome');   // nessun percorso di file o dettaglio interno nelle risposte

// Siti autorizzati a usare il ponte (aggiungi qui altri domini se serve)
$ALLOWED = ['https://andreaglightburn.github.io', 'https://iz2oii.eu', 'https://www.iz2oii.eu', 'http://localhost'];
// Nota: CORS decide solo quali pagine web possono leggere le risposte; non è un'autenticazione.
// Contro gli abusi c'è il limite di richieste per IP più sotto.

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array(rtrim($origin, '/'), $ALLOWED, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function data_dir($sub) {
    $base = __DIR__ . '/cache';
    if (!is_dir($base)) @mkdir($base, 0700);
    if (is_dir($base) && !is_file($base . '/.htaccess')) @file_put_contents($base . '/.htaccess', "Require all denied\nDeny from all\n");
    if (!is_dir($base) || !is_writable($base)) $base = sys_get_temp_dir() . '/intervia';
    $d = $base . '/' . $sub;
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return $d;
}

/* ---------- Limite di richieste per IP (finestra di un minuto) ---------- */
function client_key() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';          // non si usa X-Forwarded-For: è falsificabile
    if (strpos($ip, ':') !== false) {                    // IPv6: si raggruppa per /64
        $bin = @inet_pton($ip);
        if ($bin !== false) $ip = bin2hex(substr($bin, 0, 8)) . '::/64';
    }
    return substr(sha1('intervia|' . $ip), 0, 20);       // nei file non resta l'IP in chiaro
}
function rate_limit($bucket, $max) {
    $f = data_dir('rate') . '/' . client_key() . '_' . $bucket . '_' . date('YmdHi');
    $n = (int)@file_get_contents($f) + 1;
    @file_put_contents($f, (string)$n, LOCK_EX);
    if ($n > $max) { header('Retry-After: 60'); out(['ok' => false, 'error' => 'Troppe richieste: riprova fra un minuto.'], 429); }
}
/* ---------- Pulizia periodica (circa 1 richiesta su 100) ---------- */
function housekeeping() {
    if (mt_rand(1, 100) !== 1) return;
    $now = time();
    foreach (glob(data_dir('rate') . '/*') ?: [] as $f) if ($now - @filemtime($f) > 300) @unlink($f);
    foreach (glob(sys_get_temp_dir() . '/intervia_cache/*') ?: [] as $f) if ($now - @filemtime($f) > 2 * 86400) @unlink($f);
    $osm = glob(data_dir('osm') . '/*.json') ?: [];
    foreach ($osm as $i => $f) if ($now - @filemtime($f) > 180 * 86400) { @unlink($f); unset($osm[$i]); }
    if (count($osm) > 3000) {                             // tetto al numero di file: via i più vecchi
        usort($osm, fn($a, $b) => @filemtime($a) <=> @filemtime($b));
        foreach (array_slice($osm, 0, count($osm) - 3000) as $f) @unlink($f);
    }
}

const VT_BASES = ['https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/', 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/'];
// ViaggiaTreno risponde solo a richieste "da browser"; tutti gli altri servizi (in particolare OpenStreetMap,
// che rifiuta con 406 chi si finge un browser) ricevono un'identificazione onesta, come chiedono le loro regole d'uso.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Intervia/2.0';
const UA_HONEST = 'Intervia/2.0 (app di trasporto pubblico; +https://andreaglightburn.github.io/intervia/)';
function ua_for($url) { return strpos((string)parse_url($url, PHP_URL_HOST), 'viaggiatreno') !== false ? UA : UA_HONEST; }
$LAST_ERR = '';

function out($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function fail($msg, $code = 502) { out(['ok' => false, 'error' => $msg], $code); }

// Download con cache su file (evita di interrogare i siti a ogni richiesta)
function fetch_url($url, $ttl, $timeout = 15) {
    global $LAST_ERR;
    $dir = sys_get_temp_dir() . '/intervia_cache';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $file = $dir . '/' . sha1($url);
    if ($ttl > 0 && is_file($file) && time() - filemtime($file) < $ttl) return file_get_contents($file);
    $body = false; $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_USERAGENT => ua_for($url), CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_MAXREDIRS => 3]);
        if (ua_for($url) === UA) curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json, text/plain, */*', 'Referer: https://www.viaggiatreno.it/infomobilita/index.jsp']);
        $body = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($body === false) $LAST_ERR = curl_error($ch); elseif ($code >= 400) $LAST_ERR = 'HTTP ' . $code;
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: " . ua_for($url) . "\r\n"]]);
        $body = @file_get_contents($url, false, $ctx);
        $code = $body === false ? 0 : 200;
    }
    if ($body === false || $code >= 400 || $code === 0) {
        if (!$LAST_ERR) $LAST_ERR = 'nessuna risposta';
        if (is_file($file)) return file_get_contents($file);   // meglio un dato vecchio che niente
        return false;
    }
    if ($ttl > 0) @file_put_contents($file, $body);
    return $body;
}

function clean($html) {
    $t = html_entity_decode(strip_tags(preg_replace('#<br\s*/?>|</p>#i', "\n", (string)$html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim(preg_replace("/[ \t]+/", ' ', preg_replace("/\n{3,}/", "\n\n", $t)));
}

function parse_rss($xml, $source) {
    if (!$xml) return [];
    libxml_use_internal_errors(true);
    $doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA);
    if (!$doc) return [];
    $items = [];
    $nodes = $doc->channel->item ?? $doc->item ?? [];
    foreach ($nodes as $it) {
        $cats = [];
        foreach ($it->category as $c) $cats[] = trim((string)$c);
        $date = (string)($it->pubDate ?? '');
        $items[] = [
            'source' => $source,
            'title' => clean((string)$it->title),
            'text' => clean((string)$it->description),
            'link' => trim((string)$it->link),
            'date' => $date ? date('c', strtotime($date)) : null,
            'categories' => $cats,
        ];
    }
    return $items;
}

function vt($path, $ttl) {
    global $LAST_ERR;
    $errs = [];
    foreach (VT_BASES as $b) {
        $LAST_ERR = '';
        $r = fetch_url($b . $path, $ttl);
        if ($r !== false) return $r;
        $errs[] = parse_url($b, PHP_URL_SCHEME) . ': ' . $LAST_ERR;
    }
    $LAST_ERR = implode(' · ', $errs);
    return false;
}

$a = $_GET['a'] ?? '';
if (!in_array($a, ['ping', 'diag', 'train', 'info', 'strikes', 'lines', 'line', 'citylines', 'board', 'stsearch', 'rec_list', 'rec_add', 'rec_del', 'rec_data', 'collect'], true)) fail('Azione non valida', 400);
rate_limit('all', 90);
if (in_array($a, ['lines', 'line', 'citylines', 'diag'], true)) rate_limit('heavy', $a === 'citylines' || $a === 'diag' ? 12 : 40);
housekeeping();

/* ---------- Verifica ---------- */
if ($a === 'ping') out(['ok' => true, 'php' => PHP_VERSION, 'curl' => function_exists('curl_init'), 'version' => '2.1.1', 'sqlite' => class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true), 'rec' => is_file(__DIR__ . '/config.php')]);
if ($a === 'diag') {   // verifica in PARALLELO se il server raggiunge le fonti (risposta entro ~10 s)
    @set_time_limit(30);
    $q = rawurlencode('[out:json][timeout:5];node(1);out;');
    $targets = [
        'viaggiatreno_https' => VT_BASES[0] . 'cercaNumeroTrenoTrenoAutocomplete/9660',
        'viaggiatreno_http' => VT_BASES[1] . 'cercaNumeroTrenoTrenoAutocomplete/9660',
        'rfi' => 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.xml',
        'mit' => 'https://scioperi.mit.gov.it/mit2/public/scioperi',
        'overpass_de' => 'https://overpass-api.de/api/interpreter?data=' . $q,
        'overpass_kumi' => 'https://overpass.kumi.systems/api/interpreter?data=' . $q,
        'overpass_coffee' => 'https://overpass.private.coffee/api/interpreter?data=' . $q,
        'google (controllo generico)' => 'https://www.google.com/generate_204',
    ];
    $res = ['php' => PHP_VERSION, 'max_execution_time' => ini_get('max_execution_time') . ' s', 'curl' => function_exists('curl_multi_init') ? 'sì' : 'no'];
    if (!function_exists('curl_multi_init')) out(['ok' => true, 'diag' => $res + ['nota' => 'cURL non disponibile: impossibile verificare']]);
    $mh = curl_multi_init(); $hs = [];
    foreach ($targets as $k => $u) {
        $ch = curl_init($u);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 9,
            CURLOPT_USERAGENT => ua_for($u), CURLOPT_ENCODING => '', CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS]);
        curl_multi_add_handle($mh, $ch); $hs[$k] = $ch;
    }
    $t0 = microtime(true);
    $codes = [];
    do {
        curl_multi_exec($mh, $running);
        while ($info = curl_multi_info_read($mh)) $codes[(int)$info['handle']] = $info['result'];
        if ($running) curl_multi_select($mh, 0.5);
    } while ($running && microtime(true) - $t0 < 11);
    foreach ($hs as $k => $ch) {
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $tt = round(curl_getinfo($ch, CURLINFO_TOTAL_TIME), 1);
        $rc = $codes[(int)$ch] ?? null;
        $err = $rc === null ? 'ancora in attesa dopo 11 s (connessione bloccata?)' : ($rc !== CURLE_OK ? curl_strerror($rc) : '');
        $res[$k] = $code >= 200 && $code < 400 ? "ok (HTTP $code, {$tt} s)" : 'ERRORE: ' . ($err ?: ($code ? "HTTP $code" : 'nessuna risposta')) . " ({$tt} s)";
        curl_multi_remove_handle($mh, $ch); curl_close($ch);
    }
    curl_multi_close($mh);
    out(['ok' => true, 'diag' => $res]);
}

/* ---------- Treno per numero (ViaggiaTreno, servizio non ufficiale) ---------- */
if ($a === 'train') {
    $n = preg_replace('/\D/', '', $_GET['n'] ?? '');
    if ($n === '' || strlen($n) > 6) fail('Numero treno non valido', 400);
    $o = preg_replace('/[^A-Z0-9]/', '', strtoupper($_GET['o'] ?? ''));
    $d = preg_replace('/\D/', '', $_GET['d'] ?? '');
    if ($o === '' || $d === '') {
        $txt = vt('cercaNumeroTrenoTrenoAutocomplete/' . $n, 300);
        if ($txt === false) fail('ViaggiaTreno non risponde (' . $LAST_ERR . ')');
        $matches = [];
        foreach (preg_split('/\r?\n/', trim($txt)) as $line) {
            if (strpos($line, '|') === false) continue;
            [$label, $key] = explode('|', $line, 2);
            $p = explode('-', trim($key));
            if (count($p) >= 3) $matches[] = ['label' => trim($label), 'n' => $p[0], 'o' => $p[1], 'd' => $p[2]];
        }
        if (count($matches) !== 1) out(['ok' => true, 'matches' => $matches]);
        $o = $matches[0]['o']; $d = $matches[0]['d'];
    }
    $json = vt("andamentoTreno/$o/$n/$d", 45);
    if ($json === false || trim($json) === '') fail('Dati del treno non disponibili (forse non circola oggi)', 404);
    $t = json_decode($json, true);
    if (!is_array($t)) fail('Risposta non valida da ViaggiaTreno');
    $stops = [];
    foreach (($t['fermate'] ?? []) as $f) {
        $stops[] = [
            'name' => $f['stazione'] ?? '',
            'id' => $f['id'] ?? '',
            'type' => $f['tipoFermata'] ?? '',                       // P partenza, F fermata, A arrivo
            'arrSched' => $f['arrivo_teorico'] ?? null, 'arrReal' => $f['arrivoReale'] ?? null,
            'depSched' => $f['partenza_teorica'] ?? null, 'depReal' => $f['partenzaReale'] ?? null,
            'delayArr' => $f['ritardoArrivo'] ?? null, 'delayDep' => $f['ritardoPartenza'] ?? null,
            'track' => $f['binarioEffettivoPartenzaDescrizione'] ?? $f['binarioEffettivoArrivoDescrizione'] ?? $f['binarioProgrammatoPartenzaDescrizione'] ?? $f['binarioProgrammatoArrivoDescrizione'] ?? null,
            'trackSched' => $f['binarioProgrammatoPartenzaDescrizione'] ?? $f['binarioProgrammatoArrivoDescrizione'] ?? null,
            'cancelled' => (($f['actualFermataType'] ?? 0) == 3),
        ];
    }
    out(['ok' => true, 'train' => [
        'number' => $n,
        'name' => trim(($t['compNumeroTreno'] ?? '') ?: (($t['categoria'] ?? '') . ' ' . $n)),
        'category' => $t['categoria'] ?? '',
        'origin' => $t['origine'] ?? '', 'destination' => $t['destinazione'] ?? '',
        'delay' => $t['ritardo'] ?? null,
        'lastStation' => $t['stazioneUltimoRilevamento'] ?? null,
        'lastTime' => $t['oraUltimoRilevamento'] ?? null,
        'status' => is_array($t['compRitardo'] ?? null) ? ($t['compRitardo'][0] ?? '') : '',
        'cancelled' => !empty($t['provvedimento']) && $t['provvedimento'] == 1,
        'notes' => $t['subTitle'] ?? '',
        'stops' => $stops,
        'o' => $o, 'd' => $d,
    ]]);
}

/* ---------- Infomobilità RFI ---------- */
if ($a === 'info') {
    $base = 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.';
    $live = parse_rss(fetch_url($base . 'updates.xml', 180), 'live');
    $notices = parse_rss(fetch_url($base . 'notices.xml', 900), 'notice');
    if (!$live && !$notices) fail('Infomobilità RFI non disponibile');
    out(['ok' => true, 'live' => $live, 'notices' => $notices]);
}

/* ---------- Scioperi (Ministero Infrastrutture e Trasporti) ---------- */
if ($a === 'strikes') {
    // 1) feed RSS del Ministero
    foreach (['https://scioperi.mit.gov.it/mit2/public/scioperi/rss', 'https://scioperi.mit.gov.it/mit2/public/rss'] as $u) {
        $items = parse_rss(fetch_url($u, 1800), 'mit');
        if ($items) out(['ok' => true, 'format' => 'rss', 'items' => $items]);
    }
    // 2) in alternativa legge la tabella della pagina pubblica
    $html = fetch_url('https://scioperi.mit.gov.it/mit2/public/scioperi', 1800);
    if ($html === false) fail('Calendario scioperi non disponibile');
    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML('<?xml encoding="utf-8"?>' . $html);
    $rows = [];
    foreach ($dom->getElementsByTagName('table') as $table) {
        $head = [];
        foreach ($table->getElementsByTagName('th') as $th) $head[] = clean($th->textContent);
        if (count($head) < 4) continue;
        foreach ($table->getElementsByTagName('tr') as $tr) {
            $cells = [];
            foreach ($tr->getElementsByTagName('td') as $td) $cells[] = clean($td->textContent);
            if (count($cells) < 4) continue;
            $r = [];
            foreach ($cells as $i => $v) $r[$head[$i] ?? ('col' . $i)] = $v;
            $rows[] = $r;
        }
        if ($rows) break;
    }
    if (!$rows) fail('Formato del calendario scioperi cambiato: avvisa lo sviluppatore');
    out(['ok' => true, 'format' => 'table', 'rows' => $rows]);
}

/* ---------- Linee da OpenStreetMap (Overpass), con cache di un giorno ---------- */
// Dati OpenStreetMap: conservati senza scadenza; rinnovati in sottofondo dopo 7 giorni
const OSM_FRESH = 7 * 86400;
function osm_cache_file($ql) {
    $f = data_dir('osm') . '/' . sha1($ql) . '.json';
    if (!is_file($f)) {                                   // recupera i dati salvati dalle versioni 1.4–1.5
        foreach ([__DIR__ . '/cache/' . sha1($ql) . '.json', sys_get_temp_dir() . '/intervia_osm/' . sha1($ql) . '.json'] as $old)
            if (is_file($old)) { @rename($old, $f) || @copy($old, $f); break; }
    }
    return $f;
}
function overpass_fetch($ql) {
    global $LAST_ERR;
    $servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    $timeout = strpos($ql, 'area') !== false ? 130 : 60;
    $errs = [];
    if (!function_exists('curl_multi_init')) {          // senza cURL: un server alla volta
        foreach ($servers as $srv) {
            $LAST_ERR = '';
            $r = fetch_url($srv . '?data=' . rawurlencode($ql), 0, $timeout);
            if ($r !== false) { $j = json_decode($r, true); if (is_array($j) && isset($j['elements'])) return $j; }
            $errs[] = parse_url($srv, PHP_URL_HOST) . ': ' . ($LAST_ERR ?: 'risposta non valida');
        }
        $LAST_ERR = implode(' · ', $errs);
        return false;
    }
    // tutti i server in parallelo: vince la prima risposta valida
    $mh = curl_multi_init(); $hs = [];
    foreach ($servers as $srv) {
        $ch = curl_init($srv . '?data=' . rawurlencode($ql));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_USERAGENT => UA_HONEST, CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_MAXREDIRS => 3]);
        curl_multi_add_handle($mh, $ch); $hs[] = [$ch, $srv];
    }
    $result = false; $running = 0;
    do {
        $st = curl_multi_exec($mh, $running);
        if ($st > CURLM_OK) break;
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle']; $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $host = parse_url(curl_getinfo($ch, CURLINFO_EFFECTIVE_URL), PHP_URL_HOST);
            if ($info['result'] === CURLE_OK && $code == 200) {
                $j = json_decode(curl_multi_getcontent($ch), true);
                if (is_array($j) && isset($j['elements'])) { $result = $j; break 2; }
                $errs[] = $host . ': risposta non valida';
            } else $errs[] = $host . ': ' . ($info['result'] !== CURLE_OK ? curl_error($ch) : 'HTTP ' . $code);
        }
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running);
    foreach ($hs as [$ch]) { curl_multi_remove_handle($mh, $ch); curl_close($ch); }
    curl_multi_close($mh);
    if ($result === false) $LAST_ERR = implode(' · ', $errs ?: ['nessuna risposta']);
    return $result;
}
$OSM_DATE = null;
function overpass_q($ql) {
    global $OSM_DATE;
    $file = osm_cache_file($ql);
    $force = !empty($_GET['fresh']);
    if (is_file($file)) {
        $age = time() - filemtime($file);
        // "Aggiorna ora": consentito al massimo una volta l'ora per non sovraccaricare OpenStreetMap
        if (!$force || $age < 3600) {
            $j = json_decode(file_get_contents($file), true);
            if (is_array($j)) {
                $OSM_DATE = date('c', filemtime($file));
                if ($age > OSM_FRESH && function_exists('fastcgi_finish_request')) {
                    register_shutdown_function(function () use ($ql, $file) {
                        fastcgi_finish_request(); ignore_user_abort(true); @set_time_limit(180);
                        $n = overpass_fetch($ql);
                        if ($n !== false) @file_put_contents($file, json_encode($n, JSON_UNESCAPED_UNICODE));
                    });
                }
                return $j;
            }
        }
    }
    // una sola richiesta per volta verso OpenStreetMap per la stessa interrogazione:
    // chi arriva dopo aspetta e poi trova il dato già salvato
    $lock = @fopen($file . '.lock', 'c');
    if ($lock) flock($lock, LOCK_EX);
    if (is_file($file) && time() - filemtime($file) < 120) {
        $j = json_decode(file_get_contents($file), true);
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
        if (is_array($j)) { $OSM_DATE = date('c', filemtime($file)); return $j; }
    }
    $j = overpass_fetch($ql);
    if ($j !== false) @file_put_contents($file, json_encode($j, JSON_UNESCAPED_UNICODE));
    if ($lock) { flock($lock, LOCK_UN); fclose($lock); @unlink($file . '.lock'); }
    if ($j === false) {
        if (is_file($file)) { $old = json_decode(file_get_contents($file), true); if (is_array($old)) { $OSM_DATE = date('c', filemtime($file)); return $old; } }
        return false;
    }
    $OSM_DATE = date('c');
    return $j;
}
if ($a === 'lines') {
    $refs = [];
    foreach (explode(',', $_GET['refs'] ?? '') as $r) {
        $r = trim($r);
        if ($r !== '' && preg_match('/^[\p{L}\p{N} \/.\-]{1,12}$/u', $r)) $refs[] = $r;
    }
    $refs = array_slice(array_unique($refs), 0, 8);
    $bb = array_map('floatval', explode(',', $_GET['bbox'] ?? ''));
    if (!$refs || count($bb) !== 4) fail('Parametri non validi', 400);
    // arrotonda il riquadro per riusare la cache
    $bb = array_map(fn($v) => round($v, 1), $bb);
    $bbs = implode(',', $bb);
    $parts = '';
    foreach ($refs as $r) $parts .= 'relation["type"="route"]["ref"="' . str_replace('"', '', $r) . '"](' . $bbs . ');';
    $j = overpass_q('[out:json][timeout:50];(' . $parts . ');out tags center;');
    if ($j === false) fail('OpenStreetMap non risponde (' . $LAST_ERR . ')');
    out(['ok' => true, 'elements' => $j['elements'], 'date' => $OSM_DATE]);
}
if ($a === 'line') {
    $ids = array_slice(array_filter(array_map(fn($v) => preg_replace('/\D/', '', $v), explode(',', $_GET['id'] ?? ''))), 0, 30);
    if (!$ids) fail('Parametri non validi', 400);
    sort($ids);
    $id = 'id:' . implode(',', $ids);
    $j = overpass_q('[out:json][timeout:50];relation(' . $id . ')->.r;.r out body;node(r.r);out body;(way(r.r:"platform");way(r.r:"platform_entry_only");way(r.r:"platform_exit_only"););out tags center;');
    if ($j === false) fail('OpenStreetMap non risponde (' . $LAST_ERR . ')');
    out(['ok' => true, 'elements' => $j['elements'], 'date' => $OSM_DATE]);
}

if ($a === 'citylines') {
    @set_time_limit(150);
    $area = preg_replace('/\D/', '', $_GET['area'] ?? '');
    $name = trim($_GET['name'] ?? '');
    if ($area !== '') $sel = 'area(' . $area . ')->.a;';
    elseif ($name !== '' && preg_match('/^[\p{L} \'\-.]{2,40}$/u', $name))
        $sel = 'area["name"="' . str_replace('"', '', $name) . '"]["boundary"="administrative"]["admin_level"~"^(7|8)$"]->.a;';
    else fail('Parametri non validi', 400);
    $j = overpass_q('[out:json][timeout:120];' . $sel . 'relation["type"="route"]["route"~"^(bus|trolleybus|tram|subway|light_rail|train|monorail|ferry|coach|share_taxi)$"](area.a);out tags;');
    if ($j === false) fail('OpenStreetMap non risponde (' . $LAST_ERR . ')');
    out(['ok' => true, 'elements' => $j['elements'], 'date' => $OSM_DATE]);
}

/* ---------- Stazioni ViaggiaTreno: ricerca e tabellone ---------- */
function vt_norm($s) {
    $s = strtoupper(trim((string)$s));
    $s = strtr($s, ['À'=>'A','È'=>'E','É'=>'E','Ì'=>'I','Ò'=>'O','Ù'=>'U','à'=>'A','è'=>'E','é'=>'E','ì'=>'I','ò'=>'O','ù'=>'U']);
    $s = str_replace(['P.TA', 'P.GARIBALDI', "'", '-', '.'], ['PORTA', 'PORTA GARIBALDI', ' ', ' ', ' '], $s);
    $s = preg_replace('/\b(STAZIONE|FS|FNM|TRENORD|CENTRALE FS)\b/', ' ', $s);
    return trim(preg_replace('/\s+/', ' ', $s));
}
function vt_stations($q) {
    $q = trim(preg_replace('/[^\p{L}\p{N} \'\-.]/u', '', (string)$q));
    if (mb_strlen($q) < 2) return [];
    $j = json_decode((string)vt('cercaStazione/' . rawurlencode(strtoupper($q)), 30 * 86400), true);
    $out = [];
    foreach (is_array($j) ? $j : [] as $x) if (!empty($x['id'])) $out[] = ['id' => $x['id'], 'name' => $x['nomeLungo'] ?? $x['label'] ?? $x['id']];
    return $out;
}
// Dal nome della fermata (es. "Milano Cadorna") al codice ViaggiaTreno; null se non è una stazione ferroviaria nota
function vt_station_by_name($name) {
    $n = vt_norm($name);
    if ($n === '') return null;
    $words = explode(' ', $n);
    for ($k = count($words); $k >= 1; $k--) {                // "Milano Porta Genova FS" → prova anche con meno parole
        $list = vt_stations(implode(' ', array_slice($words, 0, $k)));
        if (!$list) continue;
        foreach ($list as $x) if (vt_norm($x['name']) === $n) return $x;
        if ($k === count($words) && count($list) === 1) return $list[0];
        foreach ($list as $x) {                              // "Milano Lambrate M2" → MILANO LAMBRATE; "Abbiategrasso Piazza Marconi" (bus) → nessuna
            $v = vt_norm($x['name']);
            if (strlen($v) >= 6 && strpos($n, $v) === 0 && preg_match('/^( (M\d|S\d{1,2}|FS|FN|FNM|RFI|\d{1,2}))*$/', substr($n, strlen($v)))) return $x;
        }
        return null;
    }
    return null;
}
function vt_date($t) { return rawurlencode(date('D M d Y H:i:s', $t) . ' GMT' . date('O', $t)); }
const VT_CLIENT = [1 => 'Trenitalia', 2 => 'Trenitalia', 4 => 'Trenitalia', 18 => 'Tper', 63 => 'Trenord', 64 => 'Trenitalia Tper', 910 => 'Ferrovie del Sud Est'];
// Righe del tabellone: ritardo null = ancora sconosciuto (treno non partito dall'origine)
function vt_board($stId, $kind, $t, $ttl = 50) {
    $j = json_decode((string)vt(($kind === 'arr' ? 'arrivi/' : 'partenze/') . $stId . '/' . vt_date($t), $ttl), true);
    if (!is_array($j)) return null;
    $rows = [];
    foreach ($j as $x) {
        $arr = $kind === 'arr';
        $sched = $arr ? ($x['orarioArrivo'] ?? null) : ($x['orarioPartenza'] ?? null);
        // "nonPartito" = non ancora partito da QUESTA stazione; il ritardo è noto se ViaggiaTreno lo dà (null = treno non ancora partito dall'origine)
        $known = isset($x['ritardo']) && $x['ritardo'] !== null && (!empty($x['circolante']) || !empty($x['ultimoRilev']));
        $rows[] = [
            'n' => (string)($x['numeroTreno'] ?? ''), 'cat' => trim($x['categoriaDescrizione'] ?? $x['categoria'] ?? ''),
            'sched' => $sched, 'delay' => $known ? (int)($x['ritardo'] ?? 0) : null, 'started' => $known,
            'inStation' => !empty($arr ? ($x['inStazione'] ?? false) : ($x['inStazione'] ?? false)),
            'track' => $arr ? ($x['binarioEffettivoArrivoDescrizione'] ?? null) : ($x['binarioEffettivoPartenzaDescrizione'] ?? null),
            'trackSched' => $arr ? ($x['binarioProgrammatoArrivoDescrizione'] ?? null) : ($x['binarioProgrammatoPartenzaDescrizione'] ?? null),
            'cancelled' => isset($x['provvedimento']) && $x['provvedimento'] == 1,
            'origin' => $x['origine'] ?? null, 'dest' => $x['destinazione'] ?? null,
            'o' => $x['codOrigine'] ?? null, 'd' => $x['dataPartenzaTreno'] ?? null,
            'client' => VT_CLIENT[$x['codiceCliente'] ?? 0] ?? null,
        ];
    }
    return $rows;
}
if ($a === 'stsearch') out(['ok' => true, 'stations' => array_slice(vt_stations($_GET['q'] ?? ''), 0, 15)]);
if ($a === 'board') {
    $kind = ($_GET['kind'] ?? '') === 'arr' ? 'arr' : 'dep';
    $id = preg_replace('/[^A-Z0-9]/', '', strtoupper($_GET['st'] ?? ''));
    $st = $id ? ['id' => $id, 'name' => $_GET['name'] ?? $id] : vt_station_by_name($_GET['name'] ?? '');
    if (!$st) out(['ok' => true, 'station' => null, 'trains' => []]);          // fermata non ferroviaria: niente da aggiungere
    $t = (int)($_GET['t'] ?? 0); $t = $t > 0 ? intdiv($t, 1000) : time();
    $rows = vt_board($st['id'], $kind, $t);
    if ($rows === null) fail('ViaggiaTreno non risponde (' . $LAST_ERR . ')');
    out(['ok' => true, 'station' => $st, 'trains' => $rows]);
}

/* ---------- Registrazione dei ritardi (SQLite) ---------- */
// config.php: 'gestori' (creano ed eliminano), 'lettori' (solo report e dati), 'cron' (solo la raccolta automatica).
// Ogni persona ha la sua chiave: per togliere l'accesso a qualcuno basta cancellare la sua riga.
function rec_cfg() {
    $f = __DIR__ . '/config.php';
    $c = is_file($f) ? (include $f) : null;
    $users = [];
    if (is_array($c)) {
        if (!empty($c['key'])) $users[] = ['name' => 'gestore', 'key' => $c['key'], 'role' => 'gestore'];      // formato semplice: una sola chiave
        foreach (['gestori' => 'gestore', 'lettori' => 'lettore'] as $grp => $role)
            foreach ((array)($c[$grp] ?? []) as $name => $key) $users[] = ['name' => (string)$name, 'key' => (string)$key, 'role' => $role];
        if (!empty($c['cron'])) $users[] = ['name' => 'cron', 'key' => (string)$c['cron'], 'role' => 'cron'];
    }
    $users = array_values(array_filter($users, fn($u) => strlen($u['key']) >= 12));
    if (!$users) fail('Registrazioni non attive: manca config.php con almeno una chiave di 12 o più caratteri (vedi LEGGIMI).', 503);
    return $users;
}
function rec_auth($a) {
    $k = (string)($_POST['k'] ?? $_GET['k'] ?? '');
    $me = null;
    foreach (rec_cfg() as $u) if ($k !== '' && hash_equals($u['key'], $k)) { $me = $u; break; }
    if (!$me) { usleep(300000); fail('Chiave delle registrazioni errata', 403); }
    $allowed = ['collect' => ['cron', 'gestore'], 'rec_add' => ['gestore'], 'rec_del' => ['gestore'], 'rec_list' => ['gestore', 'lettore'], 'rec_data' => ['gestore', 'lettore']];
    if (!in_array($me['role'], $allowed[$a], true))
        fail($me['role'] === 'lettore' ? 'La tua chiave è di sola lettura: puoi scaricare report e dati, non creare o eliminare registrazioni.' : 'Questa chiave serve solo alla raccolta automatica.', 403);
    return $me;
}
function rec_db() {
    if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) fail('Il server non ha SQLite (PDO): chiedi ad Aruba o usa un altro hosting', 503);
    $db = new PDO('sqlite:' . data_dir('rec') . '/ritardi.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA busy_timeout = 10000');
    $db->exec('CREATE TABLE IF NOT EXISTS recs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, code TEXT NOT NULL, origin TEXT, label TEXT, start TEXT NOT NULL, end TEXT NOT NULL,
        dirs TEXT, created INTEGER, last_run INTEGER, last_err TEXT)');
    $db->exec('CREATE TABLE IF NOT EXISTS obs (rec_id INTEGER NOT NULL, day TEXT NOT NULL, train TEXT NOT NULL, cat TEXT, origin TEXT, dest TEXT, station TEXT, station_id TEXT NOT NULL,
        kind TEXT NOT NULL, sched INTEGER, real INTEGER, delay INTEGER, track TEXT, track_sched TEXT, cancelled INTEGER DEFAULT 0, src TEXT, final INTEGER DEFAULT 0,
        o TEXT, d INTEGER, seen INTEGER, PRIMARY KEY (rec_id, day, train, station_id, kind))');
    return $db;
}
function rec_status($r, $today) { return $today < $r['start'] ? 'attesa' : ($today > $r['end'] ? 'completata' : 'in corso'); }
function day_of($ms) { return date('Y-m-d', intdiv((int)$ms, 1000)); }

// Salva/aggiorna un'osservazione senza mai cancellare un dato definitivo
function obs_put($db, $r) {
    static $st = null;
    if (!$st) $st = $db->prepare('INSERT INTO obs (rec_id, day, train, cat, origin, dest, station, station_id, kind, sched, real, delay, track, track_sched, cancelled, src, final, o, d, seen)
        VALUES (:rec_id, :day, :train, :cat, :origin, :dest, :station, :station_id, :kind, :sched, :real, :delay, :track, :track_sched, :cancelled, :src, :final, :o, :d, :seen)
        ON CONFLICT (rec_id, day, train, station_id, kind) DO UPDATE SET
          cat = COALESCE(excluded.cat, cat), origin = COALESCE(excluded.origin, origin), dest = COALESCE(excluded.dest, dest),
          real = CASE WHEN final = 1 AND excluded.final = 0 THEN real ELSE COALESCE(excluded.real, real) END,
          delay = CASE WHEN final = 1 AND excluded.final = 0 THEN delay ELSE COALESCE(excluded.delay, delay) END,
          src = CASE WHEN final = 1 AND excluded.final = 0 THEN src ELSE excluded.src END,
          track = COALESCE(excluded.track, track), track_sched = COALESCE(excluded.track_sched, track_sched),
          cancelled = MAX(cancelled, excluded.cancelled), final = MAX(final, excluded.final),
          o = COALESCE(excluded.o, o), d = COALESCE(excluded.d, d), seen = excluded.seen');
    $st->execute($r + ['real' => null, 'track' => null, 'track_sched' => null, 'o' => null, 'd' => null, 'origin' => null, 'dest' => null, 'cat' => null]);
}
function vt_train($o, $n, $d, $ttl = 90) {
    $j = json_decode((string)vt("andamentoTreno/$o/$n/$d", $ttl), true);
    return is_array($j) && !empty($j['fermate']) ? $j : null;
}
// Fermate di un andamento → osservazioni (arrivo e partenza separati)
function train_rows($recId, $t, $n, $o, $d, $only = null) {
    $rows = []; $now = time() * 1000;
    $fer = $t['fermate']; $lastIdx = count($fer) - 1;
    $ended = !empty($fer[$lastIdx]['arrivoReale']);
    foreach ($fer as $i => $f) {
        if ($only && ($f['id'] ?? '') !== $only) continue;
        $canc = ($f['actualFermataType'] ?? 0) == 3 || (isset($t['provvedimento']) && $t['provvedimento'] == 1);
        foreach (['arr' => ['arrivo_teorico', 'arrivoReale', 'ritardoArrivo', 'binarioEffettivoArrivoDescrizione', 'binarioProgrammatoArrivoDescrizione'],
                  'dep' => ['partenza_teorica', 'partenzaReale', 'ritardoPartenza', 'binarioEffettivoPartenzaDescrizione', 'binarioProgrammatoPartenzaDescrizione']] as $kind => $k) {
            if (($kind === 'arr' && $i === 0) || ($kind === 'dep' && $i === $lastIdx) || empty($f[$k[0]])) continue;
            $real = $f[$k[1]] ?? null;
            $late = $f[$k[0]] + 6 * 3600e3 < $now;            // dopo 6 ore senza orario reale si chiude con quel che c'è
            $rows[] = ['rec_id' => $recId, 'day' => day_of($d), 'train' => (string)$n, 'cat' => trim($t['categoria'] ?? ''), 'origin' => $t['origine'] ?? null, 'dest' => $t['destinazione'] ?? null,
                'station' => $f['stazione'] ?? '', 'station_id' => $f['id'] ?? '', 'kind' => $kind, 'sched' => $f[$k[0]], 'real' => $real,
                'delay' => $real ? (int)round(($real - $f[$k[0]]) / 60000) : (isset($f[$k[2]]) && !empty($t['oraUltimoRilevamento']) ? (int)$f[$k[2]] : null),
                'track' => $f[$k[3]] ?? null, 'track_sched' => $f[$k[4]] ?? null, 'cancelled' => $canc ? 1 : 0,
                'src' => $real ? 'reale' : 'stima', 'final' => ($real || $canc || $ended || $late) ? 1 : 0, 'o' => $o, 'd' => $d, 'seen' => time()];
        }
    }
    return $rows;
}
function collect_rec($db, $r, $deadline) {
    $now = time();
    if ($r['kind'] === 'train') {
        $o = $r['origin']; $n = $r['code'];
        foreach ([strtotime('today'), strtotime('yesterday')] as $day) {     // anche il treno partito ieri sera ancora in viaggio
            $ds = date('Y-m-d', $day);
            if ($ds < $r['start'] || $ds > $r['end']) continue;
            $t = vt_train($o, $n, $day * 1000, 60);
            if ($t) foreach (train_rows($r['id'], $t, $n, $o, $day * 1000) as $row) obs_put($db, $row);
        }
        return;
    }
    // stazione: tabellone (dato provvisorio) …
    foreach (explode(',', $r['dirs'] ?: 'dep,arr') as $kind) {
        $rows = vt_board($r['code'], $kind, $now, 0);
        if ($rows === null) throw new Exception('tabellone non disponibile');
        foreach ($rows as $x) {
            if (!$x['sched'] || !$x['n']) continue;
            $ds = day_of($x['sched']);
            if ($ds < $r['start'] || $ds > $r['end']) continue;
            obs_put($db, ['rec_id' => $r['id'], 'day' => $ds, 'train' => $x['n'], 'cat' => $x['cat'], 'origin' => $x['origin'], 'dest' => $x['dest'], 'station' => $r['label'],
                'station_id' => $r['code'], 'kind' => $kind, 'sched' => $x['sched'], 'delay' => $x['delay'], 'track' => $x['track'], 'track_sched' => $x['trackSched'],
                'cancelled' => $x['cancelled'] ? 1 : 0, 'src' => 'tabellone', 'final' => 0, 'o' => $x['o'], 'd' => $x['d'], 'seen' => $now]);
        }
    }
    // … poi, per i treni già passati, l'orario reale dall'andamento del treno (dato definitivo)
    $q = $db->prepare('SELECT * FROM obs WHERE rec_id = ? AND final = 0 AND sched + COALESCE(delay, 0) * 60000 < ? ORDER BY sched LIMIT 60');
    $q->execute([$r['id'], ($now - 600) * 1000]);
    foreach ($q->fetchAll() as $x) {
        if (time() > $deadline) break;
        $t = ($x['o'] && $x['d']) ? vt_train($x['o'], $x['train'], $x['d'], 120) : null;
        $done = false;
        if ($t) foreach (train_rows($r['id'], $t, $x['train'], $x['o'], $x['d'], $r['code']) as $row) {
            if ($row['kind'] !== $x['kind']) continue;
            $row['station'] = $r['label'];
            obs_put($db, $row); $done = $row['final'] == 1;
        }
        if (!$done && $x['sched'] < ($now - 6 * 3600) * 1000)            // nessun orario reale dopo 6 ore: resta il dato del tabellone
            $db->prepare('UPDATE obs SET final = 1 WHERE rec_id = ? AND day = ? AND train = ? AND station_id = ? AND kind = ?')
               ->execute([$r['id'], $x['day'], $x['train'], $x['station_id'], $x['kind']]);
    }
}

if (in_array($a, ['rec_list', 'rec_add', 'rec_del', 'rec_data', 'collect'], true)) {
    $me = rec_auth($a);
    $db = rec_db();
    try { $db->exec('ALTER TABLE recs ADD COLUMN created_by TEXT'); } catch (Throwable $e) {}   // colonna aggiunta in 2.1
    $today = date('Y-m-d');
    if ($a === 'collect') {
        ignore_user_abort(true); @set_time_limit(60);
        $deadline = time() + 25;                         // cron-job.org attende al massimo 30 s
        $lock = @fopen(data_dir('rec') . '/collect.lock', 'c');
        if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) out(['ok' => true, 'note' => 'raccolta già in corso']);
        $done = [];
        $recs = $db->query("SELECT * FROM recs WHERE start <= date('now', 'localtime') AND end >= date('now', 'localtime', '-1 day') ORDER BY COALESCE(last_run, 0)")->fetchAll();
        foreach ($recs as $r) {
            if (time() > $deadline) break;
            $err = null;
            try { $db->beginTransaction(); collect_rec($db, $r, $deadline); $db->commit(); }
            catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); $err = substr($e->getMessage() . ($LAST_ERR ? ' (' . $LAST_ERR . ')' : ''), 0, 200); }
            $db->prepare('UPDATE recs SET last_run = ?, last_err = ? WHERE id = ?')->execute([time(), $err, $r['id']]);
            $done[] = ['id' => (int)$r['id'], 'error' => $err];
        }
        out(['ok' => true, 'done' => $done, 'time' => date('c')]);
    }
    if ($a === 'rec_list') {
        $rows = $db->query('SELECT r.*, (SELECT COUNT(*) FROM obs o WHERE o.rec_id = r.id) AS n, (SELECT COUNT(*) FROM obs o WHERE o.rec_id = r.id AND o.final = 1) AS nfinal,
            (SELECT MAX(seen) FROM obs o WHERE o.rec_id = r.id) AS last_seen FROM recs r ORDER BY r.id DESC')->fetchAll();
        foreach ($rows as &$r) $r['status'] = rec_status($r, $today);
        out(['ok' => true, 'recs' => $rows, 'today' => $today, 'me' => ['name' => $me['name'], 'role' => $me['role']]]);
    }
    if ($a === 'rec_add') {
        $kind = ($_POST['kind'] ?? '') === 'train' ? 'train' : 'station';
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_POST['code'] ?? ''));
        $origin = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_POST['origin'] ?? ''));
        $start = $_POST['start'] ?? ''; $end = $_POST['end'] ?? '';
        $label = mb_substr(trim(strip_tags($_POST['label'] ?? '')), 0, 80);
        $dirs = implode(',', array_intersect(explode(',', $_POST['dirs'] ?? 'dep,arr'), ['dep', 'arr'])) ?: 'dep,arr';
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end) || $end < $start) fail('Periodo non valido', 400);
        if ((strtotime($end) - strtotime($start)) / 86400 > 366) fail('Periodo troppo lungo (massimo un anno)', 400);
        if ($kind === 'station' && !preg_match('/^S\d{5}$/', $code)) fail('Stazione non valida: sceglila dall\'elenco', 400);
        if ($kind === 'train') {
            if (!preg_match('/^\d{1,6}$/', $code)) fail('Numero treno non valido', 400);
            if ($origin === '') {                          // stazione d'origine: serve per leggere l'andamento ogni giorno
                $txt = vt('cercaNumeroTrenoTrenoAutocomplete/' . $code, 300);
                $m = [];
                foreach (preg_split('/\r?\n/', trim((string)$txt)) as $line) if (strpos($line, '|') !== false) { $p = explode('-', trim(explode('|', $line, 2)[1])); if (count($p) >= 2) $m[$p[1]] = 1; }
                if (count($m) !== 1) fail(count($m) ? 'Più treni con questo numero: aprilo dalla scheda Treni e registra da lì' : 'Treno non trovato in ViaggiaTreno (prova nel giorno in cui circola)', 400);
                $origin = array_key_first($m);
            }
        }
        if ((int)$db->query('SELECT COUNT(*) FROM recs')->fetchColumn() >= 30) fail('Troppe registrazioni (massimo 30): eliminane qualcuna', 400);
        $db->prepare('INSERT INTO recs (kind, code, origin, label, start, end, dirs, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
           ->execute([$kind, $code, $origin ?: null, $label ?: $code, $start, $end, $kind === 'station' ? $dirs : null, time(), $me['name']]);
        out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
    }
    $id = (int)($_POST['id'] ?? 0);
    $r = $db->prepare('SELECT * FROM recs WHERE id = ?'); $r->execute([$id]); $r = $r->fetch();
    if (!$r) fail('Registrazione non trovata', 404);
    if ($a === 'rec_del') {
        $db->prepare('DELETE FROM obs WHERE rec_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM recs WHERE id = ?')->execute([$id]);
        out(['ok' => true]);
    }
    if ($a === 'rec_data') {
        $q = $db->prepare('SELECT day, train, cat, origin, dest, station, station_id, kind, sched, real, delay, track, track_sched, cancelled, src, final FROM obs WHERE rec_id = ? ORDER BY sched');
        $q->execute([$id]);
        $r['status'] = rec_status($r, $today);
        out(['ok' => true, 'rec' => $r, 'rows' => $q->fetchAll(PDO::FETCH_NUM),
             'cols' => ['day', 'train', 'cat', 'origin', 'dest', 'station', 'station_id', 'kind', 'sched', 'real', 'delay', 'track', 'track_sched', 'cancelled', 'src', 'final']]);
    }
}

fail('Azione non valida', 400);
