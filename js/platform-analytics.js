/* ============================================================
   Platform control room — Live Analytics.

   A self-contained view for platform.html. Reads the aggregated
   telemetry API; renders pure strings; no framework, no chart
   library. Exposed on window because the page's nav is classic JS:
     renderAnalytics(), setAnalyticsRange(range), _loadLiveStrip()
   ============================================================ */
(function () {
  'use strict';

  var RANGE = '24h';
  var TIMER = null;

  var nf = new Intl.NumberFormat('en-KE');

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? nf.format(Math.round(n)) : '—';
  }
  function pct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return (n > 0 && n < 1 ? n.toFixed(1) : Math.round(n * 10) / 10) + '%';
  }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }
  function timeLabel(t, range) {
    var d = new Date(t);
    if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (range === '7d') return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function avg(a) {
    return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0;
  }
  function trend(points, pick, invert) {
    var vals = (points || []).map(function (p) { return Number(pick(p)) || 0; });
    if (vals.length < 4) return '';
    var mid = Math.floor(vals.length / 2);
    var a = avg(vals.slice(0, mid));
    var b = avg(vals.slice(mid));
    if (!a) return '';
    var d = Math.round(((b - a) / a) * 100);
    if (!d) return '<span class="pa-cmd-delta flat">flat</span>';
    var bad = invert ? d > 0 : d < 0;
    return '<span class="pa-cmd-delta ' + (bad ? 'up' : 'down') + '">' +
      (d > 0 ? '▲' : '▼') + ' ' + Math.abs(d) + '%</span>';
  }

  /* ── Chart primitives ───────────────────────────────────── */
  var chartId = 0;
  function chart(points, pick, color) {
    var vals = (points || []).map(function (p) { return Number(pick(p)) || 0; });
    var n = vals.length;
    if (n < 2) return '<div class="pa-cmd-chart-empty">Collecting history…</div>';
    var max = Math.max(1, Math.max.apply(null, vals));
    var id = 'paGrad' + (++chartId);
    var coords = vals.map(function (v, i) {
      return ((i / (n - 1)) * 100).toFixed(2) + ',' + (30 - (v / max) * 26).toFixed(2);
    });
    var last = coords[coords.length - 1].split(',');
    return '<svg class="pa-cmd-chart-svg" viewBox="0 0 100 34" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity=".38"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      [8, 16, 24].map(function (y) {
        return '<line x1="0" y1="' + y + '" x2="100" y2="' + y + '" stroke="rgba(148,163,184,.12)" stroke-width=".35"/>';
      }).join('') +
      '<polygon points="0,34 ' + coords.join(' ') + ' 100,34" fill="url(#' + id + ')"/>' +
      '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="1.2" fill="' + color + '"/>' +
      '</svg>';
  }

  function mini(points, pick, color) {
    var vals = (points || []).map(function (p) { return Number(pick(p)) || 0; });
    var n = vals.length;
    if (n < 2) return '<div class="pa-cmd-mini-empty"></div>';
    var max = Math.max(1, Math.max.apply(null, vals));
    var coords = vals.map(function (v, i) {
      return ((i / (n - 1)) * 100).toFixed(2) + ',' + (16 - (v / max) * 14).toFixed(2);
    }).join(' ');
    return '<svg class="pa-cmd-mini" viewBox="0 0 100 18" preserveAspectRatio="none">' +
      '<polyline points="' + coords + '" fill="none" stroke="' + color + '" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  function gauge(label, value, max, unit, hint) {
    var v = Number(value);
    var p = Number.isFinite(v) && max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0;
    var color = p >= 90 ? '#f97066' : p >= 70 ? '#fdb022' : '#32d583';
    var r = 16;
    var c = 2 * Math.PI * r;
    var off = c * (1 - p / 100);
    return '<div class="pa-cmd-gauge">' +
      '<svg viewBox="0 0 40 40" class="pa-cmd-ring">' +
      '<circle cx="20" cy="20" r="' + r + '" fill="none" stroke="rgba(16,24,40,.10)" stroke-width="3"/>' +
      '<circle cx="20" cy="20" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 20 20)"/>' +
      '<text x="20" y="21.5" text-anchor="middle" fill="#101828" font-size="7.5" font-weight="700">' + p + '%</text>' +
      '</svg>' +
      '<div class="pa-cmd-gauge-body"><div class="pa-cmd-gauge-label">' + esc(label) + '</div>' +
      '<div class="pa-cmd-gauge-value">' + (Number.isFinite(v) ? num(v) + (unit || '') : '—') + '</div>' +
      '<div class="pa-cmd-gauge-hint">' + hint + '</div></div></div>';
  }

  function kpi(opts) {
    return '<div class="pa-cmd-kpi ' + (opts.tone || '') + '">' +
      '<div class="pa-cmd-kpi-label">' + esc(opts.label) + (opts.delta || '') + '</div>' +
      '<div class="pa-cmd-kpi-value">' + opts.value + (opts.unit ? '<span>' + opts.unit + '</span>' : '') + '</div>' +
      '<div class="pa-cmd-kpi-sub">' + opts.sub + '</div>' +
      (opts.spark || '') +
      '</div>';
  }

  function barRow(label, value, max, meta, danger) {
    var p = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    return '<div class="pa-cmd-bar-row">' +
      '<div class="pa-cmd-bar-top"><span class="pa-cmd-bar-label" title="' + esc(label) + '">' + esc(label) + '</span>' +
      '<span class="pa-cmd-bar-value">' + num(value) + '</span></div>' +
      '<div class="pa-cmd-bar-track"><div class="pa-cmd-bar-fill ' + (danger ? 'danger' : '') + '" style="width:0" data-w="' + p + '"></div></div>' +
      '<div class="pa-cmd-bar-meta">' + meta + '</div>' +
      '</div>';
  }

  function panel(title, right, body, className) {
    return '<section class="pa-cmd-panel ' + (className || '') + '">' +
      '<header class="pa-cmd-panel-head"><h3>' + title + '</h3><span>' + (right || '') + '</span></header>' +
      body + '</section>';
  }

  function skeleton() {
    var tiles = '';
    for (var i = 0; i < 8; i++) tiles += '<div class="pa-cmd-skel-tile"></div>';
    return '<div class="pa-cmd pa-cmd-loading">' +
      '<div class="pa-cmd-skel-head"></div>' +
      '<div class="pa-cmd-kpis">' + tiles + '</div>' +
      '<div class="pa-cmd-grid"><div class="pa-cmd-skel-panel"></div><div class="pa-cmd-skel-panel"></div></div>' +
      '<div class="pa-cmd-grid"><div class="pa-cmd-skel-panel tall"></div><div class="pa-cmd-skel-panel tall"></div></div>' +
      '</div>';
  }

  function errorView(message) {
    return '<div class="pa-cmd pa-cmd-loading">' +
      '<div class="pa-cmd-error">' +
      '<div class="pa-cmd-error-icon">◌</div>' +
      '<h2>The meters are warming up</h2>' +
      '<p>Telemetry starts collecting on the first authenticated request after deploy. ' +
      'If this stays empty, check that <code>PLATFORM_TELEMETRY</code> is not set to <code>off</code>.</p>' +
      '<p class="pa-cmd-error-detail">' + esc(message || '') + '</p>' +
      '<button class="pa-cmd-btn primary" onclick="renderAnalytics()">Try again</button>' +
      '</div></div>';
  }

  /* ── Data ───────────────────────────────────────────────── */
  function get(path) {
    return fetch(path, { credentials: 'include' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' → ' + r.status);
      return r.json();
    }).then(function (j) { return j.data; });
  }

  function fetched() {
    return Promise.all([
      get('/api/platform/analytics/overview'),
      get('/api/platform/analytics/history?range=' + RANGE),
      get('/api/platform/analytics/system'),
      get('/api/platform/analytics/errors?range=' + RANGE),
    ]);
  }

  /* ── Main view ──────────────────────────────────────────── */
  function view(d) {
    var o = d[0] || {};
    var h = d[1] || {};
    var sys = d[2] || {};
    var errors = d[3] || [];
    var health = sys.health || o.system || {};
    var tel = sys.telemetry || o.telemetry || {};
    var points = h.points || [];
    var users = explainsUsers(o);
    var traffic = o.traffic || {};
    var modules = (o.modules || []).slice(0, 7);
    var slow = (o.slowRoutes || []).slice(0, 7);
    var schools = (o.schools || []).slice(0, 7);
    var errs = (errors || []).slice(0, 7);
    var maxModule = Math.max(1, Math.max.apply(null, modules.map(function (m) { return m.requests || 0; })));
    var maxSlow = Math.max(1, Math.max.apply(null, slow.map(function (r) { return r.p95 || 0; })));
    var maxSchool = Math.max(1, Math.max.apply(null, schools.map(function (s) { return s.requests || 0; })));
    var liveBySchool = {};
    (o.users && o.users.bySchool || []).forEach(function (s) { liveBySchool[s.schoolId] = s.count; });
    var range = RANGE;
    var errRate = Number(traffic.errorRate) || 0;
    var p95 = Number(traffic.p95) || 0;
    var lastAt = points.length ? timeLabel(points[points.length - 1].t, range) : '';

    var rangeBtn = function (r, label) {
      return '<button class="' + (range === r ? 'active' : '') + '" onclick="setAnalyticsRange(\'' + r + '\')">' + label + '</button>';
    };

    var moduleBars = modules.map(function (m) {
      var danger = Number(m.errorRate) >= 1;
      var meta = num(m.schools) + ' school' + (m.schools === 1 ? '' : 's') +
        ' · p95 ' + num(m.p95) + ' ms · 5xx ' + num(m.errors5);
      return barRow(m.module, m.requests, maxModule, meta, danger);
    }).join('');
    if (!moduleBars) moduleBars = '<div class="pa-cmd-empty">No module traffic yet.</div>';

    var slowRows = slow.map(function (r) {
      var danger = Number(r.errorRate) >= 1;
      return barRow(r.route, r.p95, maxSlow,
        num(r.requests) + ' req · 5xx ' + num(r.errors5) + ' · ' + pct(r.errorRate), danger);
    }).join('');
    if (!slowRows) slowRows = '<div class="pa-cmd-empty">Nothing slow enough to rank yet.</div>';

    var schoolRows = schools.map(function (s) {
      var live = liveBySchool[s.schoolId] || 0;
      return barRow(s.name, s.requests, maxSchool,
        num(live) + ' online · p95 ' + num(s.p95) + ' ms · ' + pct(s.errorRate),
        Number(s.errorRate) >= 1);
    }).join('');
    if (!schoolRows) schoolRows = '<div class="pa-cmd-empty">No school traffic yet.</div>';

    var errorRows = errs.map(function (e) {
      var bad = Number(e.errors5) > 0;
      return '<div class="pa-cmd-error-row ' + (bad ? 'bad' : '') + '">' +
        '<span class="pa-cmd-error-route" title="' + esc(e.route) + '">' + esc(e.route) + '</span>' +
        '<span class="pa-cmd-error-count">' + num(e.errors5) + ' <em>5xx</em></span>' +
        '<span class="pa-cmd-error-count soft">' + num(e.errors4) + ' <em>4xx</em></span>' +
        '<span class="pa-cmd-error-rate">' + pct(e.errorRate) + '</span>' +
        '</div>';
    }).join('');
    if (!errorRows) errorRows = '<div class="pa-cmd-empty">No errors in this window. Good.</div>';

    return '<div class="pa-cmd">' +
      '<header class="pa-cmd-head">' +
        '<div>' +
          '<div class="pa-cmd-eyebrow"><span class="pa-cmd-live"></span> CONTROL ROOM <span class="pa-cmd-sep">/</span> LIVE</div>' +
          '<h2>System pulse</h2>' +
          '<p>Every authenticated request, reduced to a histogram before it ever touches the database.</p>' +
        '</div>' +
        '<div class="pa-cmd-actions">' +
          '<div class="pa-cmd-range">' + rangeBtn('24h', '24h') + rangeBtn('7d', '7d') + rangeBtn('30d', '30d') + '</div>' +
          '<button class="pa-cmd-btn" onclick="renderAnalytics()" title="Refresh now">↻ Refresh</button>' +
        '</div>' +
      '</header>' +

      '<div class="pa-cmd-kpis">' +
        kpi({
          label: 'Active now',
          value: num(o.users && o.users.now),
          sub: num(o.users && o.users.m15) + ' in 15 min · ' + num(o.users && o.users.h1) + ' in 1 h',
          tone: 'violet',
          spark: mini(points, function (p) { return p.requests; }, '#a78bfa'),
        }) +
        kpi({
          label: 'Requests / min',
          value: num(traffic.perMinute),
          sub: num(traffic.requests) + ' in the last hour',
          delta: trend(points, function (p) { return p.requests; }, false),
          spark: mini(points, function (p) { return p.requests; }, '#818cf8'),
        }) +
        kpi({
          label: 'p95 latency',
          value: num(p95),
          unit: 'ms',
          sub: 'p50 ' + num(traffic.p50) + ' · p99 ' + num(traffic.p99),
          tone: p95 > 500 ? 'warn' : 'mint',
          delta: trend(points, function (p) { return p.p95; }, true),
          spark: mini(points, function (p) { return p.p95; }, '#2dd4bf'),
        }) +
        kpi({
          label: '5xx error rate',
          value: pct(errRate),
          sub: num(traffic.errors5) + ' server · ' + num(traffic.errors4) + ' client',
          tone: errRate >= 1 ? 'danger' : 'mint',
          delta: trend(points, function (p) { return p.errors5; }, true),
          spark: mini(points, function (p) { return p.errors5; }, '#fb7185'),
        }) +
        kpi({
          label: 'DAU today',
          value: num(o.users && o.users.dauToday),
          sub: 'yesterday ' + num(o.users && o.users.dauYesterday) + ' · 7d avg ' + num(o.users && o.users.dauAvg7),
          tone: 'mint',
        }) +
        kpi({
          label: 'Active schools',
          value: num((o.users && o.users.bySchool || []).length),
          sub: num(modules.length) + ' modules touched',
          tone: 'violet',
        }) +
        kpi({
          label: 'Uptime',
          value: health.uptimeSec ? Math.floor(health.uptimeSec / 3600) + 'h ' + Math.floor((health.uptimeSec % 3600) / 60) + 'm' : '—',
          sub: 'loop ' + (Number.isFinite(Number(health.eventLoopMs)) ? num(health.eventLoopMs) + ' ms' : '—') +
            ' · DB ' + (Number.isFinite(Number(health.dbPingMs)) ? num(health.dbPingMs) + ' ms' : '—'),
          tone: 'slate',
        }) +
        kpi({
          label: 'Telemetry',
          value: tel.enabled === false ? 'OFF' : 'ON',
          sub: 'flush ' + ago(tel.lastFlushAt) + ' · ' + num(tel.bufferedRoutes) + ' buffered',
          tone: tel.enabled === false ? 'danger' : 'slate',
        }) +
      '</div>' +

      '<div class="pa-cmd-grid wide">' +
        panel('Traffic', num(traffic.requests) + ' req · ' + range,
          chart(points, function (p) { return p.requests; }, '#818cf8') +
          '<div class="pa-cmd-axis"><span>' + (points[0] ? timeLabel(points[0].t, range) : '') + '</span><span>' + lastAt + '</span></div>',
          'chart-main') +
        panel('Latency', num(p95) + ' ms p95',
          chart(points, function (p) { return p.p95; }, '#2dd4bf') +
          '<div class="pa-cmd-axis"><span>peak ' + Math.max(0, Math.max.apply(null, points.map(function (p) { return p.p95 || 0; }))) + ' ms</span><span>p50 ' + num(traffic.p50) + ' · p99 ' + num(traffic.p99) + '</span></div>',
          'chart-side') +
      '</div>' +

      '<div class="pa-cmd-grid three">' +
        panel('Modules', num(modules.length) + ' active', moduleBars) +
        panel('Machine room', '30 s sample',
          '<div class="pa-cmd-gauges">' +
          gauge('Heap', health.heapUsedMb, health.heapTotalMb || 1, ' MB',
            num(health.heapUsedMb) + ' of ' + num(health.heapTotalMb) + ' · RSS ' + num(health.rssMb) + ' MB') +
          gauge('Event loop', health.eventLoopMs, 100, ' ms', 'p95 · under 50 ms is healthy') +
          gauge('Mongo', health.dbPingMs, 100, ' ms', health.dbState === 1 ? 'connected' : 'not connected') +
          gauge('Buffer', tel.bufferedRoutes, 2000, '', 'flush ' + ago(tel.lastFlushAt)) +
          '</div>' +
          '<div class="pa-cmd-machine-foot"><span>' + (sys.db ? num(sys.db.objects) + ' docs · ' + num(sys.db.dataSizeMb) + ' MB' : 'DB stats pending') + '</span>' +
          '<span class="' + (tel.flushFailures ? 'bad' : 'good') + '">' + (tel.flushFailures ? '⚠ ' + num(tel.flushFailures) + ' flush failures' : '✓ pipeline healthy') + '</span></div>') +
        panel('Errors', range, errorRows) +
      '</div>' +

      '<div class="pa-cmd-grid wide">' +
        panel('Slowest route families', 'p95 · last hour', slowRows) +
        panel('Schools by load', 'requests · last hour', schoolRows) +
      '</div>' +

      '<footer class="pa-cmd-foot">' +
        '<span>Generated ' + new Date(o.generatedAt).toLocaleTimeString() + ' · ' + range + ' window</span>' +
        '<span class="pa-cmd-foot-right">' + (users ? users : '') +
        '<span class="pa-cmd-dot ' + (tel.enabled === false ? 'off' : 'on') + '"></span> ' +
        (tel.enabled === false ? 'telemetry off' : 'streaming') + '</span>' +
      '</footer>' +
      '</div>';
  }

  function explainsUsers(o) {
    var roles = Object.keys((o.users && o.users.byRole) || {});
    if (!roles.length) return '';
    return roles.map(function (r) {
      return '<span class="pa-cmd-role">' + esc(r) + ' ' + num(o.users.byRole[r]) + '</span>';
    }).join('');
  }

  function hydrateBars(root) {
    // Bars animate from 0; set the real width on the next frame so the CSS
    // transition is visible without inline animation code in every row.
    var bars = root.querySelectorAll('.pa-cmd-bar-fill[data-w]');
    for (var i = 0; i < bars.length; i++) {
      (function (bar) { bar.style.width = bar.getAttribute('data-w') + '%'; })(bars[i]);
    }
  }

  /* ── Entry points ───────────────────────────────────────── */
  function stop() {
    if (TIMER) { clearInterval(TIMER); TIMER = null; }
  }

  function renderAnalytics() {
    stop();
    var el = document.getElementById('pa-content');
    if (!el) return;
    el.innerHTML = skeleton();
    window.__platformView = 'analytics';

    function load(first) {
      fetched().then(function (d) {
        if (window.__platformView !== 'analytics') return;
        el.innerHTML = view(d);
        hydrateBars(el);
        if (first) {
          TIMER = setInterval(function () {
            if (window.__platformView === 'analytics') load(false);
          }, 30000);
        }
      }).catch(function (e) {
        if (window.__platformView === 'analytics') el.innerHTML = errorView(e.message);
      });
    }
    load(true);
  }

  function setAnalyticsRange(r) {
    RANGE = r;
    renderAnalytics();
  }

  function loadLiveStrip() {
    var el = document.getElementById('pa-live-strip');
    if (!el) return;
    el.style.display = '';
    get('/api/platform/analytics/overview').then(function (d) {
      var t = d.traffic || {};
      var u = d.users || {};
      el.innerHTML =
        '<div class="pa-cmd-strip-card"><div class="pa-cmd-strip-label">Active now</div><div class="pa-cmd-strip-value">' + num(u.now) + '</div><div class="pa-cmd-strip-sub">' + num(u.m15) + ' in 15 min</div></div>' +
        '<div class="pa-cmd-strip-card"><div class="pa-cmd-strip-label">Requests / min</div><div class="pa-cmd-strip-value">' + num(t.perMinute) + '</div><div class="pa-cmd-strip-sub">' + num(t.requests) + ' last hour</div></div>' +
        '<div class="pa-cmd-strip-card"><div class="pa-cmd-strip-label">p95 latency</div><div class="pa-cmd-strip-value">' + num(t.p95) + '<span>ms</span></div><div class="pa-cmd-strip-sub">p50 ' + num(t.p50) + ' · p99 ' + num(t.p99) + '</div></div>' +
        '<div class="pa-cmd-strip-card ' + (Number(t.errorRate) >= 1 ? 'bad' : 'good') + '"><div class="pa-cmd-strip-label">5xx error rate</div><div class="pa-cmd-strip-value">' + pct(t.errorRate) + '</div><div class="pa-cmd-strip-sub">' + num(t.errors5) + ' server errors</div></div>' +
        '<div class="pa-cmd-strip-card link" onclick="showView(\'analytics\')"><div class="pa-cmd-strip-label">Live analytics</div><div class="pa-cmd-strip-link">Open the control room →</div></div>';
    }).catch(function () { el.style.display = 'none'; });
  }

  window.renderAnalytics = renderAnalytics;
  window.setAnalyticsRange = setAnalyticsRange;
  window._loadLiveStrip = loadLiveStrip;
  window.stopAnalyticsTimer = stop;
})();
