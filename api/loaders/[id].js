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
// CORS is allowed from any origin: some mobile executors run their HttpGet
// implementation through a WebView's fetch()/XHR, which the browser engine
// blocks from reading a cross-origin response unless the response carries
// Access-Control-Allow-Origin.
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
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>MScript Loader</title>
<style>
  :root{ color-scheme: dark; }
  *{ box-sizing:border-box; }
  html,body{ height:100%; margin:0; background:#030207; }
  body{
    display:flex; align-items:center; justify-content:center; text-align:center;
    font-family:'Segoe UI',system-ui,sans-serif; overflow:hidden; position:relative;
    padding:24px; padding-top:calc(24px + env(safe-area-inset-top,0px));
    padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));
    isolation:isolate;
  }

  /* layered background: rotating rays + drifting glow + grid + scanlines */
  .bg{ position:absolute; inset:0; z-index:-3; }
  .rays{
    position:absolute; inset:-60%;
    background:repeating-conic-gradient(from 0deg, rgba(109,99,255,.14) 0deg 5deg, transparent 5deg 11deg);
    animation:spin 70s linear infinite;
    mask-image:radial-gradient(circle at 50% 45%, #000 0%, transparent 72%);
  }
  @keyframes spin{ to{ transform:rotate(360deg); } }
  .glow{
    position:absolute; inset:0;
    background:
      radial-gradient(42vmax 42vmax at 18% 12%, rgba(239,68,68,.16), transparent 60%),
      radial-gradient(46vmax 46vmax at 85% 88%, rgba(109,99,255,.22), transparent 60%);
    animation:drift 14s ease-in-out infinite alternate;
  }
  @keyframes drift{ from{ opacity:.7; transform:scale(1); } to{ opacity:1; transform:scale(1.08); } }
  .grid{
    position:absolute; inset:0; opacity:.35;
    background-image:linear-gradient(rgba(130,122,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(130,122,255,.08) 1px, transparent 1px);
    background-size:42px 42px;
    mask-image:radial-gradient(circle at 50% 40%, #000 0%, transparent 75%);
  }
  .scan{
    position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0px, rgba(255,255,255,.035) 1px, transparent 1px, transparent 3px);
    animation:scanmove 9s linear infinite;
  }
  @keyframes scanmove{ from{ background-position-y:0; } to{ background-position-y:400px; } }

  .card{ position:relative; z-index:1; max-width:580px; }

  .badge{
    display:inline-flex; align-items:center; gap:8px; padding:7px 16px 7px 12px; border-radius:999px;
    background:rgba(109,99,255,.12); border:1px solid rgba(130,122,255,.35); color:#b9b3ff;
    font-size:.78rem; font-weight:700; letter-spacing:.09em; text-transform:uppercase; margin-bottom:26px;
  }
  .badge i{ width:7px; height:7px; border-radius:50%; background:#ff5c5c; box-shadow:0 0 8px #ff5c5c; animation:blink 1.5s ease-in-out infinite; }
  @keyframes blink{ 0%,100%{ opacity:1; } 50%{ opacity:.25; } }

  .face{ font-size:4rem; line-height:1; margin-bottom:14px; filter:drop-shadow(0 0 20px rgba(109,99,255,.55)); animation:wobble 2.6s ease-in-out infinite; }
  @keyframes wobble{
    0%,100%{ transform:rotate(0deg) translateY(0); }
    25%{ transform:rotate(-4deg) translateY(-3px); }
    75%{ transform:rotate(4deg) translateY(-3px); }
  }

  .title{ position:relative; margin:0 0 16px; font-size:3.1rem; font-weight:900; letter-spacing:.04em; line-height:1; }
  .title span{
    background:linear-gradient(135deg,#fff 10%,#b9b3ff 55%,#6D63FF 100%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    position:relative; display:inline-block;
  }
  .title::before, .title::after{
    content:'NICE TRY'; position:absolute; inset:0; left:0; right:0;
    -webkit-background-clip:text; background-clip:text; color:transparent;
    background:linear-gradient(135deg,#ff5c5c,#ff5c5c);
    opacity:.75; mix-blend-mode:screen;
  }
  .title::before{ animation:glitchA 3.6s infinite; }
  .title::after{ background:linear-gradient(135deg,#43e4ff,#43e4ff); animation:glitchB 3.6s infinite; }
  @keyframes glitchA{
    0%,89%,100%{ opacity:0; transform:translate(0,0); clip-path:inset(0 0 0 0); }
    90%{ opacity:.8; transform:translate(-3px,1px); clip-path:inset(10% 0 60% 0); }
    92%{ opacity:.8; transform:translate(3px,-1px); clip-path:inset(55% 0 10% 0); }
    94%{ opacity:0; }
  }
  @keyframes glitchB{
    0%,89%,100%{ opacity:0; transform:translate(0,0); clip-path:inset(0 0 0 0); }
    90%{ opacity:.8; transform:translate(3px,-1px); clip-path:inset(60% 0 5% 0); }
    92%{ opacity:.8; transform:translate(-3px,1px); clip-path:inset(5% 0 65% 0); }
    94%{ opacity:0; }
  }

  p{ margin:0 auto; max-width:420px; color:#9a97b3; font-size:1.05rem; line-height:1.55; }
  p b{ color:#d7d4f5; font-weight:600; }

  .pillRow{ display:flex; justify-content:center; gap:10px; margin-top:28px; flex-wrap:wrap; }
  .pill{ display:flex; align-items:center; gap:8px; padding:9px 16px; border-radius:999px; background:#0e0c18; border:1px solid #221f36; color:#7a7696; font-size:.82rem; font-family:'Consolas','Courier New',monospace; }
  .pill svg{ width:15px; height:15px; stroke:currentColor; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }

  .brand{ margin-top:34px; display:flex; align-items:center; justify-content:center; gap:8px; color:#4b4766; font-size:.78rem; letter-spacing:.1em; text-transform:uppercase; }
  .brand::before, .brand::after{ content:''; width:26px; height:1px; background:#2a263f; }
</style>
</head>
<body>
  <div class="bg"><div class="glow"></div><div class="rays"></div><div class="grid"></div></div>
  <div class="scan"></div>
  <div class="card">
    <div class="badge"><i></i>Access Denied</div>
    <div class="face">&#x1F921;</div>
    <h1 class="title"><span>NICE TRY</span></h1>
    <p>This loader isn't rendered in a browser. <b>Run it from a Roblox script executor</b> using <code>game:HttpGet</code> instead.</p>
    <div class="pillRow">
      <div class="pill"><svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 2v4M16 2v4M3.5 10h17"/></svg>Browser view blocked</div>
      <div class="pill"><svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>Executor-only content</div>
    </div>
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
  
