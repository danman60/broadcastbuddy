// OBS dock page — served at GET /dock. Add in OBS: View → Docks → Custom Browser
// Docks → http://127.0.0.1:<httpPort>/dock. Plain HTML over the existing WS hub
// (same commands as the Stream Deck / tablet) so production control + show alerts
// live inside OBS, no app switching. Stateless: renders whatever `state` BB pushes.

export function buildDockHTML(wsPort: number): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BroadcastBuddy Dock</title>
<style>
  :root { --bg:#1e1f26; --panel:#272a33; --line:#3a3e4a; --text:#e8e9ee; --dim:#9096a6;
          --ok:#2fbf71; --bad:#ff3b3b; --warn:#f5a524; --accent:#3d7bfd; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.3 system-ui,Segoe UI,sans-serif;
         user-select:none; padding:8px; }
  h2 { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); margin:10px 0 5px; }
  button { font:inherit; color:var(--text); background:var(--panel); border:1px solid var(--line);
           border-radius:6px; padding:9px 4px; cursor:pointer; min-width:0; }
  button:active { filter:brightness(1.4); }
  button.on { background:var(--accent); border-color:var(--accent); }
  button.stop { background:#7a1d1d; border-color:#a33; font-weight:700; }
  .row { display:grid; gap:5px; }
  .c2 { grid-template-columns:1fr 1fr; } .c3 { grid-template-columns:repeat(3,1fr); }
  .c4 { grid-template-columns:repeat(4,1fr); }
  #alerts { display:none; background:var(--bad); color:#fff; border-radius:6px; padding:8px;
            font-weight:700; animation:flash 1s steps(2) infinite; }
  #alerts.acked { animation:none; background:#8a2020; }
  #alerts ul { margin:0 0 6px; padding-left:16px; }
  #alerts button { width:100%; background:#fff; color:#900; border:0; font-weight:800; }
  @keyframes flash { 50% { background:#a01515; } }
  .chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
  .chip { padding:3px 7px; border-radius:10px; background:var(--panel); border:1px solid var(--line);
          font-size:11px; white-space:nowrap; }
  .chip.ok { border-color:var(--ok); color:var(--ok); } .chip.bad { border-color:var(--bad); color:var(--bad); }
  .chip.rec { background:var(--bad); color:#fff; border-color:var(--bad); }
  #ptt { width:100%; padding:14px 4px; font-weight:700; }
  #ptt.held { background:var(--ok); border-color:var(--ok); color:#000; }
  .heard { margin-top:5px; color:var(--dim); font-size:12px; min-height:16px; overflow-wrap:anywhere; }
  .heard.ok { color:var(--ok); } .heard.bad { color:var(--warn); }
  .lt { color:var(--dim); font-size:12px; margin-bottom:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .next { color:var(--text); }
  /* Voice listening + acknowledged (owner 2026-10-31: "a more animated listening. And acknowledged in the BB dock") */
  .vstate { display:flex; align-items:center; gap:8px; padding:7px 8px; margin-bottom:5px; border-radius:6px;
            border:1px solid var(--line); color:var(--dim); font-weight:700; font-size:12px; letter-spacing:.04em; }
  .vstate .bars { display:flex; align-items:center; gap:3px; height:18px; }
  .vstate .bars i { width:4px; height:4px; border-radius:2px; background:currentColor; }
  .vstate.on { color:var(--ok); border-color:var(--ok); animation:vglow 1.6s ease-in-out infinite; }
  .vstate.on .bars i { animation:vbar .9s ease-in-out infinite; }
  .vstate.on .bars i:nth-child(2) { animation-delay:.15s } .vstate.on .bars i:nth-child(3) { animation-delay:.3s }
  .vstate.on .bars i:nth-child(4) { animation-delay:.45s } .vstate.on .bars i:nth-child(5) { animation-delay:.6s }
  @keyframes vbar { 0%,100% { height:4px; } 50% { height:18px; } }
  @keyframes vglow { 0%,100% { box-shadow:0 0 0 0 transparent; } 50% { box-shadow:0 0 10px 1px var(--ok); } }
  #vstate { cursor:pointer; }
  .vack { display:none; margin-top:5px; padding:10px 8px; border-radius:6px; background:var(--ok); color:#000;
          font-weight:800; font-size:15px; text-align:center; overflow-wrap:anywhere; }
  .vack.show { display:block; animation:vack 2.5s ease-out forwards; }
  /* Sub-docks (owner 2026-10-31: "can there be sub docks? Lt, voice, direct"): /dock/lt, /dock/voice, /dock/director */
  section[hidden] { display:none; }
  .dir-live { font-size:15px; font-weight:700; margin:5px 0; overflow-wrap:anywhere; }
  .dir-next { color:var(--dim); font-size:12px; min-height:16px; overflow-wrap:anywhere; }
  #dirToggle { width:100%; font-weight:700; }
  #dirToggle.on { background:var(--ok); border-color:var(--ok); color:#000; }
  @keyframes vack { 0% { transform:scale(.8); opacity:0; } 8% { transform:scale(1.06); opacity:1; } 16% { transform:scale(1); }
                    80% { opacity:1; } 100% { opacity:0; } }
</style></head>
<body>
  <div id="alerts"><ul id="alertList"></ul><button id="ack">ACKNOWLEDGE</button></div>
  <div class="chips" id="chips"></div>

  <section data-sec="director">
  <h2>Auto Director</h2>
  <button id="dirToggle" data-cmd="autoDirectorToggle">DIRECTOR OFF</button>
  <div class="dir-live" id="dirLive"></div>
  <div class="dir-next" id="dirNext"></div>
  </section>

  <section data-sec="voice">
  <h2>Voice</h2>
  <div class="vstate" id="vstate"><span class="bars"><i></i><i></i><i></i><i></i><i></i></span><span id="vlabel">VOICE OFF</span></div>
  <button id="ptt">HOLD TO TALK</button>
  <div class="vack" id="vack"></div>
  <div class="heard" id="heard"></div>
  </section>

  <section data-sec="lt">
  <h2>Lower third</h2>
  <div class="lt" id="lt">—</div>
  <div class="lt" id="next"></div>
  <div class="row c4">
    <button data-cmd="prevTrigger">◀</button><button data-cmd="fireLT">FIRE</button>
    <button data-cmd="hideLT">HIDE</button><button data-cmd="nextTrigger">▶</button>
  </div>
  </section>
<script>
(function () {
  var WS_URL = 'ws://' + (location.hostname || '127.0.0.1') + ':${wsPort}';
  var ws = null, connected = false, state = null, everConnected = false;
  var $ = function (id) { return document.getElementById(id); };
  // /dock/<section> shows just that section (status chips only on the full dock; alerts everywhere)
  var only = location.pathname.split('/').filter(Boolean)[1];
  if (only) {
    $('chips').style.display = 'none';
    document.querySelectorAll('section[data-sec]').forEach(function (el) { el.hidden = el.getAttribute('data-sec') !== only; });
  }

  function send(action, data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'command', action: action, data: data || {} }));
  }

  document.querySelectorAll('[data-cmd]').forEach(function (b) {
    b.onclick = function () { send(b.getAttribute('data-cmd')); };
  });
  $('vstate').onclick = function () { send('voiceToggle'); };
  $('vstate').title = 'Click: hands-free listening on/off';
  $('ack').onclick = function () { send('ackAlerts'); localAck = true; render(); };

  var ptt = $('ptt'), held = false, lastAckAt = null;
  function down(e) { e.preventDefault(); if (held) return; held = true; ptt.classList.add('held'); send('voicePttDown'); }
  function up() { if (!held) return; held = false; ptt.classList.remove('held'); send('voicePttUp'); }
  ptt.addEventListener('pointerdown', down);
  ptt.addEventListener('pointerup', up);
  ptt.addEventListener('pointerleave', up);
  ptt.addEventListener('pointercancel', up);
  // Hold J (dock focused) = push-to-talk, same as BB's window.
  document.addEventListener('keydown', function (e) { if (e.code === 'KeyJ' && !e.repeat) down(e); });
  document.addEventListener('keyup', function (e) { if (e.code === 'KeyJ') up(); });
  window.addEventListener('blur', up);

  // Alarm beep while any un-acked alert (or BB itself unreachable) stands.
  var audio = null, localAck = false;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.value = 0.25; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.35);
    } catch (e) {}
  }
  document.addEventListener('pointerdown', function () { try { audio = audio || new AudioContext(); audio.resume(); } catch (e) {} });

  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + text + '</span>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function currentAlerts() {
    if (!connected) return everConnected ? [{ id: 'bb', text: 'BROADCASTBUDDY NOT RESPONDING', acked: localAck }] : [];
    return (state && state.health && state.health.alerts) || [];
  }

  function render() {
    var alerts = currentAlerts();
    var box = $('alerts');
    box.style.display = alerts.length ? 'block' : 'none';
    $('alertList').innerHTML = alerts.map(function (a) { return '<li>' + esc(a.text) + '</li>'; }).join('');
    box.classList.toggle('acked', alerts.length > 0 && alerts.every(function (a) { return a.acked; }));

    var c = [];
    if (!connected) c.push(chip('BB offline', 'bad'));
    else {
      var h = (state && state.health) || {};
      c.push(chip('OBS', h.obs ? 'ok' : 'bad'));
      c.push(h.recording ? chip('● REC ' + esc(h.recTimecode || ''), 'rec') : chip('not recording'));
      if (h.streaming) c.push(chip('LIVE', 'ok'));
      [1, 2].forEach(function (n) {
        var v = h.cams ? h.cams[n] : null;
        if (v !== null && v !== undefined) c.push(chip('CAM' + n, v ? 'ok' : 'bad'));
      });
      var vs = state && state.voice;
      if (vs) c.push(chip(vs.helper === 'ready' ? (vs.wake ? 'VOICE hands-free' : 'VOICE') : 'VOICE off', vs.helper === 'ready' ? 'ok' : 'bad'));
    }
    $('chips').innerHTML = c.join('');

    var ad = state && state.autoDirector;
    $('dirToggle').classList.toggle('on', !!(ad && ad.on));
    $('dirToggle').textContent = ad && ad.on ? 'DIRECTOR ON' : 'DIRECTOR OFF';
    $('dirLive').textContent = ad && ad.on && ad.live ? 'LIVE: ' + ad.live : '';
    $('dirNext').textContent = ad && ad.on && ad.next ? 'NEXT: ' + ad.next + (ad.secondsLeft != null ? ' in ' + ad.secondsLeft + 's' : '') : (ad && ad.message) || '';

    var vs2 = state && state.voice, heard = $('heard');
    var vOn = !!(vs2 && vs2.helper === 'ready' && vs2.listening);
    $('vstate').classList.toggle('on', vOn);
    $('vlabel').textContent = !vs2 || vs2.helper !== 'ready' ? 'VOICE OFF' : vOn ? (vs2.wake ? 'LISTENING · hands-free' : 'LISTENING…') : 'VOICE READY · hold to talk';
    if (vs2 && vs2.lastResult) {
      var r = vs2.lastResult;
      if (r.at !== lastAckAt) {
        // New accepted command → big green confirmation (not the one already there when the dock loaded).
        var fresh = lastAckAt !== null; lastAckAt = r.at;
        if (fresh && r.ok) {
          var va = $('vack'); va.textContent = '✓ ' + r.text; va.classList.remove('show'); void va.offsetWidth; va.classList.add('show');
        }
      }
      heard.textContent = (r.ok ? '✓ ' : '✗ ') + r.text + ' (' + Math.round(r.confidence * 100) + '%)';
      heard.className = 'heard ' + (r.ok ? 'ok' : 'bad');
    }
    ptt.textContent = vs2 && vs2.wake ? 'HANDS-FREE ON (hold to talk anyway)' : 'HOLD TO TALK';

    var lt = state && state.overlay && state.overlay.lowerThird, pl = state && state.playlist;
    $('lt').textContent = (pl && pl.total ? pl.current + '/' + pl.total + ' ' : '') +
      (lt ? (lt.visible ? 'ON AIR: ' : '') + (lt.title || lt.name || '') : '—');
    $('next').innerHTML = pl && pl.upNextTitle
      ? 'NEXT: <span class="next">' + esc(pl.upNextTitle) + '</span>' + (pl.upNextSubtitle ? ' · ' + esc(pl.upNextSubtitle) : '')
      : '';
  }

  setInterval(function () {
    var a = currentAlerts();
    if (a.length && a.some(function (x) { return !x.acked; })) beep();
  }, 3000);

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = function () {
      connected = true; everConnected = true; localAck = false;
      ws.send(JSON.stringify({ type: 'identify', client: 'obs-dock' }));
      render();
    };
    ws.onmessage = function (ev) {
      try { var m = JSON.parse(ev.data); if (m.type === 'state') { state = m; render(); } } catch (e) {}
    };
    ws.onclose = function () { connected = false; render(); setTimeout(connect, 2000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  render();
  connect();
})();
</script>
</body></html>`
}
