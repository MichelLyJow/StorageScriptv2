// Vercel serverless function (Node runtime).
// Public URL: https://<your-domain>/loaders/<id>  (mapped here by vercel.json rewrites)
//
// Behaviour:
//  - A real browser navigating to the link -> troll "NICE TRY" page (HTML)
//  - A Roblox executor calling game:HttpGet(...) -> raw Lua code (text/plain)
//
// The real code is fetched server-side from the Firebase Realtime Database,
// so it is never shipped inside index.html / this file.
//
// CORS is allowed from any origin: some mobile executors (Delta included)
// run their HttpGet implementation through a WebView's fetch()/XHR, which
// the browser engine blocks from reading a cross-origin response unless the
// response carries Access-Control-Allow-Origin. Without this header the
// request can succeed over the wire yet the executor still never sees the
// body, which looks exactly like "the script just doesn't run".
//
// Add ?debug=1 to the URL to always get a plain-text dump of the headers
// this function received and which branch it chose, instead of the normal
// troll page / code response. Handy for figuring out what a specific
// executor's HttpGet actually sends: run
//   print(game:HttpGet("<your loader link>?debug=1"))
// from the executor's console and read the output.

const https = require('https');

const DB_HOST = "script-web-8d4a7-default-rtdb.asia-southeast1.firebasedatabase.app";

function fetchCode(id) {
  return new Promise((resolve, reject) => {
    const path = '/loaders/' + encodeURIComponent(id) + '/code.json';
    const req = https.get({ host: DB_HOST, path, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Real browser navigations carry Fetch-Metadata headers that are set by the
// browser engine itself and are not something a simple HTTP client (which is
// what every Roblox executor's HttpGet uses under the hood) normally sends.
// This is a much stronger signal than User-Agent alone, which some executors
// spoof to look like Chrome.
function browserSignal(req) {
  const h = req.headers || {};
  const dest = String(h['sec-fetch-dest'] || '').toLowerCase();
  const mode = String(h['sec-fetch-mode'] || '').toLowerCase();
  if (dest === 'document' || mode === 'navigate') return 'fetch-metadata (dest=' + dest + ', mode=' + mode + ')';

  // Fallback for the rare browser that strips Fetch-Metadata headers.
  // Require a very specific, hard-to-fake Accept fingerprint that real
  // Chrome/Firefox/Safari navigations send, not just "contains text/html".
  const ua = String(h['user-agent'] || '');
  const accept = String(h['accept'] || '');
  const hasBrowserUA = /mozilla/i.test(ua);
  const acceptFingerprint = /text\/html/i.test(accept) && (/xhtml\+xml/i.test(accept) || /image\/webp/i.test(accept) || /image\/avif/i.test(accept));
  const hasLang = !!h['accept-language'];
  if (hasBrowserUA && acceptFingerprint && hasLang) return 'accept-fingerprint';
  return null;
}

function trollPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MScript Loader</title>
<style>
  :root{ color-scheme: dark; }
  *{ box-sizing:border-box; }
  html,body{ height:100%; margin:0; background:#050308; }
  body{
    display:flex; align-items:center; justify-content:center; text-align:center;
    font-family:'Segoe UI',system-ui,sans-serif; overflow:hidden; position:relative;
    padding:24px; padding-top:calc(24px + env(safe-area-inset-top,0px));
    padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));
  }
  .rays{
    position:absolute; inset:-50%;
    background:repeating-conic-gradient(from 0deg, rgba(109,99,255,.16) 0deg 6deg, transparent 6deg 12deg);
    animation:spin 50s linear infinite;
  }
  @keyframes spin{ to{ transform:rotate(360deg); } }
  .card{ position:relative; z-index:1; max-width:560px; }
  .face{ font-size:4.2rem; line-height:1; margin-bottom:6px; filter:drop-shadow(0 0 18px rgba(109,99,255,.55)); animation:glitch 2.4s infinite; }
  @keyframes glitch{
    0%,100%{ transform:translate(0,0); }
    20%{ transform:translate(-2px,1px); }
    40%{ transform:translate(2px,-1px); }
    60%{ transform:translate(-1px,-1px); }
    80%{ transform:translate(1px,1px); }
  }
  h1{
    margin:10px 0 14px; font-size:3rem; font-weight:900; letter-spacing:.03em;
    background:linear-gradient(135deg,#fff,#a79bff 60%,#6D63FF);
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  p{ margin:0; color:#9a97b3; font-size:1.05rem; line-height:1.5; }
  .brand{ margin-top:30px; color:#4b4766; font-size:.85rem; letter-spacing:.08em; text-transform:uppercase; }
</style>
</head>
<body>
  <div class="rays"></div>
  <div class="card">
    <div class="face">&#x1F921;</div>
    <h1>NICE TRY</h1>
    <p>This loader isn't displayed in browsers.<br>Run it from a Roblox script executor instead.</p>
    <div class="brand">Protected by MScript</div>
  </div>
</body>
</html>`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const id = (req.query && req.query.id) || (req.url || '').split('?')[0].split('/').filter(Boolean).pop();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    res.status(400).send('Bad loader id');
    return;
  }

  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');
  const signal = browserSignal(req);

  if (debug) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const lines = Object.entries(req.headers || {}).map(([k, v]) => '  ' + k + ': ' + v);
    res.status(200).send(
      '-- MScript loader debug\n' +
      '-- decision: ' + (signal ? ('BROWSER (' + signal + ')') : 'EXECUTOR (raw code)') + '\n' +
      '-- method: ' + req.method + '\n' +
      '-- headers received:\n' + lines.join('\n') + '\n'
    );
    return;
  }

  if (signal) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(trollPage());
    return;
  }

  try {
    const code = await fetchCode(id);
    if (typeof code !== 'string' || !code) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(404).send('-- loader not found or removed');
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(code);
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(502).send('-- failed to load script, try again');
  }
};
