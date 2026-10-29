(function () {
  var WS_URL = 'ws://' + (location.hostname || '127.0.0.1') + ':' + document.currentScript.dataset.wsPort;
  var ws = null, connected = false, state = null, everConnected = false;
  var $ = function (id) { return document.getElementById(id); };

  function send(action, data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'command', action: action, data: data || {} }));
  }

  // presets 1-8
  for (var i = 1; i <= 8; i++) (function (n) {
    var b = document.createElement('button'); b.textContent = n;
    b.onclick = function () { send('cameraPreset', { id: n }); };
    $('presets').appendChild(b);
  })(i);
  document.querySelectorAll('[data-cmd]').forEach(function (b) {
    b.onclick = function () { send(b.getAttribute('data-cmd')); };
  });
  $('cam1').onclick = function () { send('cameraSelect', { id: 1 }); };
  $('cam2').onclick = function () { send('cameraSelect', { id: 2 }); };
  $('ack').onclick = function () { send('ackAlerts'); localAck = true; render(); };

  var ptt = $('ptt'), held = false;
  function down(e) { e.preventDefault(); if (held) return; held = true; ptt.classList.add('held'); send('voicePttDown'); }
  function up() { if (!held) return; held = false; ptt.classList.remove('held'); send('voicePttUp'); }
  ptt.addEventListener('pointerdown', down);
  ptt.addEventListener('pointerup', up);
  ptt.addEventListener('pointerleave', up);
  ptt.addEventListener('pointercancel', up);

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

    var cam = state && state.camera ? state.camera.activeCam : 1;
    $('cam1').classList.toggle('on', cam === 1);
    $('cam2').classList.toggle('on', cam === 2);
    var rc = state && state.camera && state.camera.recalling;
    $('moving').textContent = rc ? 'CAM' + rc.cam + ' moving to preset ' + rc.slot + '…' : '';
    document.querySelectorAll('#presets button').forEach(function (b) {
      b.classList.toggle('moving', !!rc && rc.cam === cam && String(rc.slot) === b.textContent);
    });

    var vs2 = state && state.voice, heard = $('heard');
    if (vs2 && vs2.lastResult) {
      var r = vs2.lastResult;
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
