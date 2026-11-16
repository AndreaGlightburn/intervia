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
 *   api.php?a=ping                               verifica funzionamento
 */

// Siti autorizzati a usare il ponte (aggiungi qui altri domini se serve)
$ALLOWED = ['https://andreaglightburn.github.io', 'https://iz2oii.eu', 'https://www.iz2oii.eu', 'http://localhost', 'null'];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array(rtrim($origin, '/'), $ALLOWED, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

const VT_BASES = ['https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/', 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/'];
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Intervia/1.1';
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
            CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_USERAGENT => UA, CURLOPT_ENCODING => '']);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json, text/plain, */*', 'Referer: https://www.viaggiatreno.it/infomobilita/index.jsp']);
        $body = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($body === false) $LAST_ERR = curl_error($ch); elseif ($code >= 400) $LAST_ERR = 'HTTP ' . $code;
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 15, 'header' => "User-Agent: " . UA . "\r\n"]]);
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

/* ---------- Verifica ---------- */
if ($a === 'ping') out(['ok' => true, 'php' => PHP_VERSION, 'curl' => function_exists('curl_init'), 'version' => '1.2']);
if ($a === 'diag') {   // verifica raggiungibilità delle fonti dal server
    $res = [];
    foreach (['vt_https' => VT_BASES[0] . 'cercaNumeroTrenoTrenoAutocomplete/9660', 'vt_http' => VT_BASES[1] . 'cercaNumeroTrenoTrenoAutocomplete/9660',
              'rfi' => 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.xml', 'mit' => 'https://scioperi.mit.gov.it/mit2/public/scioperi'] as $k => $u) {
        $LAST_ERR = ''; $r = fetch_url($u, 0);
        $res[$k] = $r === false ? 'ERRORE: ' . $LAST_ERR : 'ok (' . strlen($r) . ' byte)';
    }
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
function overpass_q($ql) {
    global $LAST_ERR;
    $errs = [];
    foreach (['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'] as $srv) {
        $LAST_ERR = '';
        $r = fetch_url($srv . '?data=' . rawurlencode($ql), 86400, 55);
        if ($r !== false) { $j = json_decode($r, true); if (is_array($j) && isset($j['elements'])) return $j; }
        $errs[] = parse_url($srv, PHP_URL_HOST) . ': ' . ($LAST_ERR ?: 'risposta non valida');
    }
    $LAST_ERR = implode(' · ', $errs);
    return false;
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
    out(['ok' => true, 'elements' => $j['elements']]);
}
if ($a === 'line') {
    $id = preg_replace('/\D/', '', $_GET['id'] ?? '');
    if ($id === '') fail('Parametri non validi', 400);
    $j = overpass_q('[out:json][timeout:50];relation(' . $id . ')->.r;.r out body;node(r.r);out body;(way(r.r:"platform");way(r.r:"platform_entry_only");way(r.r:"platform_exit_only"););out tags center;');
    if ($j === false) fail('OpenStreetMap non risponde (' . $LAST_ERR . ')');
    out(['ok' => true, 'elements' => $j['elements']]);
}

fail('Azione non valida', 400);
