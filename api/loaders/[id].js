// Vercel serverless function (Node runtime).
// Public URL: https://<your-domain>/loaders/<id>  (mapped here by vercel.json rewrites)
//
// Behaviour:
//  - Request looks like a real web browser  -> troll "NICE TRY" page (HTML)
//  - Request looks like a Roblox executor's HttpGet -> raw Lua code (text/plain)
//
// The real code is fetched server-side from the Firebase Realtime Database,
// so it is never shipped inside index.html / this file.

const DB_URL = "https://script-web-8d4a7-default-rtdb.asia-southeast1.firebasedatabase.app";

function looksLikeBrowser(req) {
  const ua = String(req.headers['user-agent'] || '');
  const accept = String(req.headers['accept'] || '');
  const fetchMode = String(req.headers['sec-fetch-mode'] || '');
  // Real browsers send a Mozilla-style UA AND ask for text/html (or navigate).
  // Executors' HttpGet calls almost never send both of these together.
  const hasBrowserUA = /mozilla/i.test(ua);
  const wantsHtml = /text\/html/i.test(accept) || fetchMode === 'navigate';
  return hasBrowserUA && wantsHtml;
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

module.exports = async (req, res) => {
  const id = (req.query && req.query.id) || (req.url || '').split('/').filter(Boolean).pop();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    res.status(400).send('Bad loader id');
    return;
  }

  if (looksLikeBrowser(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(trollPage());
    return;
  }

  try {
    const r = await fetch(DB_URL + '/loaders/' + encodeURIComponent(id) + '/code.json');
    const code = await r.json();
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
