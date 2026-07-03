// streamlearn dashboard — zero deps, vanilla everything.
(function () {
  'use strict';

  // ── SSE counts updater ──────────────────────────────────────────────────
  // The overview page has a <dl id="counts"> with <dt>k</dt><dd>n</dd> pairs.
  // /events emits an `event: counts` frame whenever data_version changes.
  function startSse() {
    if (window.location.pathname.indexOf('/pages/') !== -1) return;
    if (!document.getElementById('counts') || typeof EventSource === 'undefined') return;
    var es = new EventSource('/events');
    es.addEventListener('counts', function (ev) {
      if (window.location.search.indexOf('replay=1') !== -1) return;
      var dl = document.getElementById('counts');
      if (!dl) return;
      var d; try { d = JSON.parse(ev.data); } catch (_) { return; }
      var pairs = dl.querySelectorAll('dt');
      pairs.forEach(function (dt) {
        var k = dt.textContent;
        if (d[k] === undefined) return;
        var dd = dt.nextElementSibling;
        if (!dd) return;
        var fmt = Number(d[k]).toLocaleString();
        if (dd.textContent !== fmt) {
          dd.textContent = fmt;
          dd.style.transition = 'color .2s';
          dd.style.color = 'var(--green)';
          setTimeout(function () { dd.style.color = ''; }, 600);
        }
      });
    });
    es.onerror = function () {
      // EventSource auto-reconnects; nothing to do.
    };
  }

  // ── GitHub Pages auto-refresh ───────────────────────────────────────────
  function startAutoRefresh() {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    if (window.location.pathname.indexOf('/pages/') === -1) return;
    if (new URLSearchParams(window.location.search || '').get('replay') === '1') return;
    var manifestUrl = new URL('manifest.json', window.location.href);
    var known = '';
    var timer = null;
    var pendingReload = false;

    function manifestId(manifest) {
      if (!manifest || typeof manifest !== 'object') return '';
      return String(manifest.build_id || manifest.batchId || manifest.generatedAt || '');
    }

    function intervalMs() {
      return document.hidden ? 300000 : 60000;
    }

    function schedule(delay) {
      clearTimeout(timer);
      timer = setTimeout(check, delay == null ? intervalMs() : delay);
    }

    function reloadSoon(next) {
      if (pendingReload) return;
      pendingReload = true;
      setTimeout(function () {
        var url = new URL(window.location.href);
        url.searchParams.set('_sv', next || String(Date.now()));
        window.location.replace(url.href);
      }, 15000);
    }

    function check() {
      var url = manifestUrl.href + (manifestUrl.search ? '&' : '?') + '_ts=' + Date.now();
      fetch(url, { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (manifest) {
          var next = manifestId(manifest);
          if (!next) return;
          if (!known) {
            known = next;
            return;
          }
          if (next !== known) reloadSoon(next);
        })
        .catch(function () {})
        .then(function () {
          if (!pendingReload) schedule();
        });
    }

    document.addEventListener('visibilitychange', function () {
      if (!pendingReload) schedule();
    });
    schedule(5000);
  }

  // ── /search live filter ─────────────────────────────────────────────────
  function startSearch() {
    var inp = document.querySelector('input[data-search]');
    if (!inp) return;
    var results = document.getElementById('results');
    var t = null, ctrl = null;
    function fire() {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      var q = inp.value;
      var url = '/search?q=' + encodeURIComponent(q);
      fetch(url, { headers: { 'HX-Request': 'true' }, signal: ctrl.signal })
        .then(function (r) { return r.text(); })
        .then(function (html) { results.innerHTML = html; })
        .catch(function () {});
      var url2 = window.location.pathname + (q ? '?q=' + encodeURIComponent(q) : '');
      history.replaceState(null, '', url2);
    }
    inp.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(fire, 200);
    });
  }

  function startOverview() {
    var data = window.__OVERVIEW__;
    if (!data || !document.getElementById('overview-state')) return;
    renderOverview(data);
    startReplay('overview', data, renderOverview);
  }

  function renderOverview(data) {
    var root = document.getElementById('overview-state');
    if (!root || !data) return;
    var params = new URLSearchParams(window.location.search || '');
    var visible = Number(params.get('central') || window.__ENTITY_LIMIT__ || 8);
    visible = Math.max(8, Math.min(16, visible || 8));
    window.__ENTITY_LIMIT__ = visible;
    var counts = data.counts || {}, deltas = data.count_deltas || {};
    var keys = ['items', 'embedded', 'sources', 'clusters', 'triples', 'rules', 'entities', 'bridges'];
    var countHtml = keys.map(function (k) {
      var d = Number(deltas[k] || 0);
      return '<dt>' + esc(k) + '</dt><dd class="cyan">' + fmt(counts[k]) +
             (d ? ' <span class="delta">' + (d > 0 ? '+' : '') + fmt(d) + '</span>' : '') + '</dd>';
    }).join('') + '<dt>pending</dt><dd>' + fmt(data.pending || 0) + '</dd>';
    var pendingHealth = data.pending_health || {};
    if (pendingHealth.horizon_mode) {
      countHtml += '<dt>pending mode</dt><dd>' + esc(pendingHealth.horizon_mode) + '</dd>';
    }
    if (pendingHealth.estimated_minutes_to_zero !== undefined && pendingHealth.estimated_minutes_to_zero !== null) {
      countHtml += '<dt>pending eta</dt><dd>' + fmt(pendingHealth.estimated_minutes_to_zero) + ' min</dd>';
    }
    var drifters = (data.drifters || []).slice(0, 10).map(function (r) {
      return '<tr><td><code>L' + esc(r.label) + '</code></td><td>' +
             Number(r.drift || 0).toFixed(3) + '</td><td>' + fmt(r.size || 0) + '</td></tr>';
    }).join('');
    var entities = (data.entities || []).slice(0, visible).map(function (r) {
      return '<tr><td>' + esc(r.rank) + '</td><td>' + esc(r.entity) + '</td><td>' +
             Number(r.score || 0).toFixed(4) + '</td><td>' + esc(r.component) + '</td></tr>';
    }).join('');
    var runs = (data.runs || []).map(function (r) {
      var ok = r.last_exit === 0, bad = r.last_exit && r.last_exit !== 0;
      return '<tr><td>' + esc(r.stage) + '</td><td>' + esc(r.last_started || '-') +
             '</td><td class="exit-cell"><span class="tag ' + (ok ? 'ok' : bad ? 'bad' : 'warn') + '">' +
             (ok ? 'ok' : bad ? 'fail' : '-') + '</span></td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="overview-grid"><div class="card counts-rail"><h3>counts <span class="live-dot"></span></h3>' +
      '<dl class="kv" id="counts" data-sse="counts">' + countHtml + '</dl></div>' +
      '<div class="overview-main"><div class="card"><h3>top drifters</h3>' +
      (drifters ? table(['cluster', 'drift', 'size'], drifters) : '<p class="muted">no drift yet</p>') +
      '</div><div class="card"><h3>central entities</h3><span class="slider-line">' +
      '<span class="muted">8</span><input type="range" min="8" max="16" value="' + visible +
      '" data-entity-limit="1"><span class="muted">16</span><output data-entity-output="1">' +
      visible + '</output></span>' +
      (entities ? table(['rank', 'entity', 'score', 'component'], entities) : '<p class="muted">no entity graph yet</p>') +
      '</div><div class="card overview-runs"><h3>last runs</h3>' +
      (runs ? table(['stage', 'started', 'exit'], runs) : '<p class="muted">no runs yet</p>') +
      '</div></div></div>';
    var slider = root.querySelector('[data-entity-limit]');
    var out = root.querySelector('[data-entity-output]');
    if (slider) slider.addEventListener('input', function () {
      window.__ENTITY_LIMIT__ = Number(slider.value || 8);
      if (out) out.textContent = String(window.__ENTITY_LIMIT__);
      if (window.history && window.location.search.indexOf('replay=1') === -1) {
        window.history.replaceState(null, '', 'overview.html?central=' + window.__ENTITY_LIMIT__);
      }
      renderOverview(data);
    });
  }

  function startSources() {
    var data = window.__SOURCES__;
    if (!data || !document.getElementById('sources-state')) return;
    renderSources(data);
    startReplay('sources', data, renderSources);
  }

  function renderSources(data) {
    var root = document.getElementById('sources-state');
    if (!root || !data) return;
    var sources = data.sources || [];
    var total = Number(data.total_items || 0);
    var text = sources.reduce(function (a, s) { return a + Number(s.items_with_text || 0); }, 0);
    var enabled = sources.filter(function (s) { return Number(s.enabled || 0); }).length;
    var latest = sources.map(function (s) { return s.last_ts || ''; }).sort().pop() || 'no timestamps';
    var rows = sources.map(function (s) {
      return '<tr><td><a href="sources.html#' + encodeURIComponent(s.name || '') + '">' + esc(s.name || '') + '</a>' +
             '<div class="source-url">' + esc(s.url || '') + '</div></td><td><span class="tag ' +
             (s.enabled ? 'ok' : 'warn') + '">' + (s.enabled ? 'on' : 'off') + '</span></td><td>' +
             fmt(s.items || 0) + '</td><td>' + fmt(s.items_with_text || 0) + '</td><td>' +
             pct(s.corpus_share || 0) + '</td><td>' + esc(s.last_ts || '-') + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="source-summary"><span>' + enabled + ' enabled</span><span>' +
      sources.length + ' sources</span><span>' + fmt(total) + ' items</span><span>' +
      pct(total ? text / total : 0) + ' text</span><span>' + esc(latest) + '</span></div>' +
      '<div class="card table-card">' + table(['source', 'status', 'items', 'with text', 'corpus', 'latest item'], rows) + '</div>';
  }

  function startSimpleTables() {
    simpleReplay('topics', window.__TOPICS__, renderTopics);
    simpleReplay('clusters', window.__CLUSTERS__, renderClusters);
    simpleReplay('triples', window.__TRIPLES__, renderTriples);
    simpleReplay('rules', window.__RULES__, renderRules);
    simpleReplay('history', window.__HISTORY_PAYLOAD__, renderHistory);
    simpleReplay('ipfs', window.__IPFS__, renderIpfs);
  }

  function simpleReplay(kind, data, render) {
    if (!data || !document.getElementById(kind + '-state')) return;
    render(data);
    startReplay(kind, data, render);
  }

  function renderTopics(data) {
    var root = document.getElementById('topics-state');
    if (!root || !data) return;
    var topics = data.topic_rows || [];
    var series = data.series || [];
    var entities = data.entities || [];
    function topicRows(rows) {
      return rows.map(function (r) {
        return '<tr><td>' + esc(r.day || '') + '</td><td><code>' + esc(r.topic_id || '') +
          '</code></td><td>' + fmt(r.item_n || 0) + '</td><td>' + fmt(r.source_n || 0) +
          '</td><td>' + Number(r.drift || 0).toFixed(3) + '</td></tr>';
      }).join('');
    }
    function entityRows(rows) {
      return rows.map(function (r) {
        return '<tr><td>' + fmt(r.rank || 0) + '</td><td>' + esc(r.entity || '') +
          '</td><td>' + Number(r.score || 0).toFixed(4) + '</td><td>' +
          fmt(r.component || 0) + '</td></tr>';
      }).join('');
    }
    var previewTopics = topicRows(topics.slice(0, 12));
    var previewEntities = entityRows(entities.slice(0, 16));
    var allTopics = topicRows(topics);
    var allEntities = entityRows(entities);
    root.innerHTML =
      '<div class="paired-grid"><div class="primary-panel"><div class="card table-card">' +
      '<h3>topic river</h3><p class="muted">Daily topic movement remains visible at the top of the page; detailed rows continue below.</p>' +
      miniLine(series.map(function (r) { return Number(r.n || 0); }), '#58e6d9') +
      (previewTopics ? table(['day', 'topic', 'items', 'sources', 'drift'], previewTopics) : '<p class="muted">no topic-day index rows yet</p>') +
      '</div></div><div class="secondary-panel"><div class="card table-card">' +
      '<h3>central entities</h3><p class="muted">Top entities stay visible beside the river instead of displacing it.</p>' +
      (previewEntities ? table(['rank', 'entity', 'score', 'component'], previewEntities) : '<p class="muted">no central entities yet</p>') +
      '</div></div><div class="wide card table-card"><h3>recent topic flow</h3>' +
      (allTopics ? table(['day', 'topic', 'items', 'sources', 'drift'], allTopics) : '<p class="muted">no topic-day index rows yet</p>') +
      '</div><div class="wide card table-card"><h3>central entity register</h3>' +
      (allEntities ? table(['rank', 'entity', 'score', 'component'], allEntities) : '<p class="muted">no central entities yet</p>') +
      '</div></div>';
  }

  function renderClusters(data) {
    var root = document.getElementById('clusters-state');
    var html = (data.clusters || []).slice(0, 50).map(function (c) {
      var rows = (c.samples || []).slice(0, 8).map(function (s) {
        return '<tr><td><code>#' + esc(s.id) + '</code></td><td>' + esc(s.text || '') + '</td></tr>';
      }).join('');
      return '<div class="card"><h3>cluster <code>L' + esc(c.label) + '</code> <span class="muted">size ' +
             fmt(c.size || 0) + '</span></h3><table>' + rows + '</table></div>';
    }).join('');
    if (root) root.innerHTML = html || '<div class="empty">no clusters yet</div>';
  }

  function renderTriples(data) {
    var rows = (data.triples || []).map(function (r) {
      return '<tr><td>' + esc(r.subj) + '</td><td><code>' + esc(r.pred) + '</code></td><td>' +
             esc(r.obj) + '</td><td>' + fmt(r.n || 0) + '</td><td>' +
             Number(r.confidence || 0).toFixed(2) + '</td></tr>';
    }).join('');
    var root = document.getElementById('triples-state');
    if (root) root.innerHTML = '<div class="card">' + table(['subj', 'pred', 'obj', 'count', 'conf'], rows) + '</div>';
  }

  function renderRules(data) {
    var rows = (data.rules || []).map(function (r) {
      return '<tr><td>' + esc((r.antecedent || []).join(' & ')) + '</td><td class="muted">-></td><td>' +
             esc((r.consequent || []).join(' & ')) + '</td><td>' +
             esc(r.sample_state || 'observed') + '</td><td>' +
             Number(r.robust_progress || 0).toFixed(2) + '</td><td>' +
             (r.belief_score == null ? '' : Number(r.belief_score || 0).toFixed(2)) +
             '</td><td>' + Number(r.support || 0).toFixed(3) +
             '</td><td>' + Number(r.confidence || 0).toFixed(2) + '</td><td>' +
             Number(r.lift || 0).toFixed(2) + '</td></tr>';
    }).join('');
    var root = document.getElementById('rules-state');
    if (root) root.innerHTML = '<div class="card">' + table(['if', '', 'then', 'state', 'robust', 'score', 'support', 'conf', 'lift'], rows) + '</div>';
  }

  function renderHistory(data) {
    var root = document.getElementById('history-state');
    if (!root || !data) return;
    var s = data.storage || {};
    var frameRows = (data.frames || []).map(function (r) {
      var href = r.kind === 'overview' ? '/?replay=1&run_id=' + r.run_id :
        '/' + r.kind + '?replay=1&run_id=' + r.run_id;
      return '<tr><td>' + esc(r.kind) + '</td><td>' + esc(r.run_id) + '</td><td>' +
             esc(r.ts) + '</td><td>' + fmt(r.bytes || 0) + '</td><td><a href="' + href + '">open</a></td></tr>';
    }).join('');
    var archiveRows = (data.archives || []).map(function (r) {
      return '<tr><td>' + esc(r.year) + '</td><td>' + esc(r.codec) + '</td><td>' +
             esc(r.compression_pass) + '</td><td>' + fmt(r.frame_count || 0) + '</td><td>' +
             fmt(r.bytes || 0) + '</td><td>' + esc(r.packed_at || '') + '</td></tr>';
    }).join('');
    root.innerHTML = '<div class="card"><h3>storage</h3><dl class="kv"><dt>database</dt><dd class="cyan">' +
      fmtBytes(s.db_bytes || 0) + '</dd><dt>frames</dt><dd>' + fmt(s.history_frame_count || 0) +
      '</dd><dt>history archives</dt><dd>' + fmtBytes(s.history_archive_bytes || 0) +
      '</dd><dt>corpus archives</dt><dd>' + fmtBytes(s.corpus_archive_bytes || 0) +
      '</dd><dt>soft used</dt><dd>' + pct(s.soft_warning_used || 0) +
      '</dd><dt>hard used</dt><dd>' + pct(s.hard_warning_used || 0) + '</dd></dl></div>' +
      '<div class="card"><h3>frames</h3>' + (frameRows ? table(['kind', 'run', 'time', 'bytes', ''], frameRows) : '<p class="muted">no frames yet</p>') +
      '</div><div class="card"><h3>archives</h3>' + (archiveRows ? table(['year', 'codec', 'pass', 'frames', 'bytes', 'packed'], archiveRows) : '<p class="muted">no archives yet</p>') + '</div>';
  }

  function renderIpfs(data) {
    var root = document.getElementById('ipfs-state');
    if (!root || !data) return;
    var stats = data.stats || {};
    var cells = data.cells || [];
    var archives = data.archives || [];
    var peers = stats.peer_ids || [];
    var cellRows = cells.map(function (c) {
      var pinOk = c.pin_status === 'recursive';
      var restoreOk = c.restore_status === 'verified';
      return '<tr><td>' + esc(c.year) + '</td><td>' + esc(c.pass_no) +
        '</td><td><code>' + esc(shortHash(c.cid, 18)) + '</code></td><td><span class="tag ' +
        (pinOk ? 'ok' : 'warn') + '">' + esc(c.pin_status || 'unknown') +
        '</span></td><td><span class="tag ' + (restoreOk ? 'ok' : 'warn') + '">' +
        esc(c.restore_status || 'missing') + '</span></td><td>' +
        fmtBytes(c.encrypted_bytes || 0) + '</td><td>' +
        esc(shortHash(c.source_checksum, 14)) + '</td><td>' +
        esc(c.last_pin_check_at || '') + '</td></tr>';
    }).join('');
    var archiveRows = archives.map(function (a) {
      var restoreOk = a.restore_status === 'verified';
      return '<tr><td>' + esc(a.year) + '</td><td>' + esc(a.pass_no) +
        '</td><td>' + fmt(a.item_count || 0) + '</td><td>' +
        fmtBytes(a.compressed_bytes || 0) + '</td><td><span class="tag ' +
        (restoreOk ? 'ok' : 'warn') + '">' + esc(a.restore_status || 'missing') +
        '</span></td><td><span class="tag ' + (a.has_ipfs_cell ? 'ok' : 'warn') +
        '">' + (a.has_ipfs_cell ? 'ipfs' : 'archive only') + '</span></td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="card viz-card"><h3>storage constellation</h3>' + ipfsMap(data) + '</div>' +
      '<div class="storage-grid"><div class="card"><h3>pin state</h3><dl class="kv">' +
      '<dt>cells</dt><dd class="cyan">' + fmt(stats.cell_count || 0) + '</dd>' +
      '<dt>recursive pins</dt><dd>' + fmt(stats.pinned_count || 0) + '</dd>' +
      '<dt>peer ids</dt><dd>' + fmt(peers.length || 0) + '</dd></dl></div>' +
      '<div class="card"><h3>archive state</h3><dl class="kv">' +
      '<dt>archives</dt><dd class="cyan">' + fmt(stats.archive_count || 0) + '</dd>' +
      '<dt>verified cells</dt><dd>' + fmt(stats.verified_count || 0) + '</dd>' +
      '<dt>archive only</dt><dd>' + fmt(stats.open_archive_count || 0) + '</dd></dl></div>' +
      '<div class="card"><h3>bytes</h3><dl class="kv">' +
      '<dt>source</dt><dd class="cyan">' + fmtBytes(stats.source_bytes || 0) + '</dd>' +
      '<dt>encrypted</dt><dd>' + fmtBytes(stats.encrypted_bytes || 0) + '</dd>' +
      '<dt>local copy</dt><dd>deleted by default</dd></dl></div>' +
      '<div class="card wide table-card"><h3>ipfs cells</h3>' +
      (cellRows ? table(['year', 'pass', 'cid', 'pin', 'restore', 'encrypted', 'source checksum', 'last check'], cellRows) : '<p class="muted">no IPFS archive cells yet</p>') +
      '</div><div class="card wide table-card"><h3>archive readiness</h3>' +
      (archiveRows ? table(['year', 'pass', 'items', 'compressed', 'restore', 'ipfs'], archiveRows) : '<p class="muted">no verified corpus archives yet</p>') +
      '</div></div>';
  }

  function shortHash(value, n) {
    value = String(value || '');
    n = n || 12;
    return value.length <= n ? value : value.slice(0, n) + '...';
  }

  function fmtBytes(n) {
    var value = Number(n || 0);
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return i === 0 ? String(Math.round(value)) + ' ' + units[i] : value.toFixed(2) + ' ' + units[i];
  }

  function ipfsMap(data) {
    var cells = data.cells || [];
    var archives = (data.archives || []).filter(function (a) { return !a.has_ipfs_cell; });
    var nodes = cells.length ? cells : archives;
    var w = 960, h = 320, cx = w / 2, cy = h / 2;
    if (!nodes.length) {
      return '<svg class="ipfs-map" viewBox="0 0 ' + w + ' ' + h + '" role="img">' +
        '<rect width="' + w + '" height="' + h + '" fill="#050810"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="52" fill="none" stroke="#3a4554"/>' +
        '<text x="' + cx + '" y="' + cy + '" fill="#6b7684" text-anchor="middle" font-size="14">no archive cells yet</text></svg>';
    }
    var parts = [
      '<rect width="' + w + '" height="' + h + '" fill="#050810"/>',
      '<circle cx="' + cx + '" cy="' + cy + '" r="36" fill="rgba(88,230,217,.10)" stroke="#58e6d9"/>',
      '<text x="' + cx + '" y="' + (cy + 5) + '" fill="#58e6d9" text-anchor="middle" font-size="12">archive root</text>'
    ];
    nodes.forEach(function (node, i) {
      var angle = (Math.PI * 2 * i / Math.max(nodes.length, 1)) - 1.5708;
      var radius = 98 + (i % 3) * 34;
      var x = cx + radius * Math.cos(angle);
      var y = cy + radius * Math.sin(angle);
      var hasCid = Object.prototype.hasOwnProperty.call(node, 'cid');
      var verified = node.restore_status === 'verified';
      var pinned = node.pin_status === 'recursive';
      var color = hasCid ? (verified && pinned ? '#5be084' : pinned ? '#f0a050' : '#e85a7a') : '#6b7684';
      var label = hasCid ? (String(node.year || '') + ' ' + shortHash(node.cid, 10)) : (String(node.year || '') + ' archive only');
      var size = hasCid ? Math.max(7, Math.min(24, 7 + String(Number(node.encrypted_bytes || 0).toString(2)).length / 2)) : 8;
      parts.push('<line x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(120,200,220,.18)"/>');
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + size.toFixed(1) + '" fill="' + color + '" fill-opacity=".82" stroke="#e8ecf1" stroke-opacity=".25"/>');
      parts.push('<text x="' + x.toFixed(1) + '" y="' + (y + size + 16).toFixed(1) + '" fill="#aab3bf" text-anchor="middle" font-size="11">' + esc(label) + '</text>');
    });
    return '<svg class="ipfs-map" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="IPFS archive constellation">' + parts.join('') + '</svg>';
  }

  // ── /scatter — 3D PCA, hand-rolled rotation ─────────────────────────────
  function startScatter() {
    var data = window.__SCATTER__;
    var cv = document.getElementById('scat');
    if (!data || !cv) return;
    var ctx = cv.getContext('2d');
    var tip = document.getElementById('scatter-tip');
    var ax = 0.4, ay = -0.6, autoSpin = true, raf = null;
    var dragging = false, lx = 0, ly = 0;
    var hover = null, lastDrawn = [];
    var palette = ['#58e6d9', '#a78bff', '#f0a050', '#5be084', '#e85a7a',
                   '#7ab8ff', '#d8c060', '#a0e0a0'];
    function colorFor(k) { return k < 0 ? '#3a4554' : palette[k % palette.length]; }
    function points() { return Array.isArray(data && data.pts) ? data.pts : []; }
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = cv.getBoundingClientRect();
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize(); window.addEventListener('resize', resize);
    function project(p) {
      var cx = Math.cos(ax), sx = Math.sin(ax);
      var cy = Math.cos(ay), sy = Math.sin(ay);
      var y1 = p.y * cx - p.z * sx;
      var z1 = p.y * sx + p.z * cx;
      var x2 = p.x * cy + z1 * sy;
      var z2 = -p.x * sy + z1 * cy;
      return { x: x2, y: y1, z: z2, k: p.k, p: p };
    }
    function hideTip() {
      hover = null;
      if (tip) tip.classList.add('hidden');
    }
    function showTip(m, p) {
      if (!tip || !p) return;
      tip.innerHTML = '<b>#' + esc(p.id) + '</b><br>cluster L' + esc(p.k) +
        '<br>source ' + esc(p.source_id);
      tip.style.left = Math.max(0, Math.min(cv.clientWidth - 220, m.x)) + 'px';
      tip.style.top = Math.max(0, Math.min(cv.clientHeight - 90, m.y)) + 'px';
      tip.classList.remove('hidden');
    }
    function pointer(e) {
      var r = cv.getBoundingClientRect();
      var t = e.touches && e.touches.length ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function updateHover(e) {
      if (!lastDrawn.length) return hideTip();
      var m = pointer(e), best = null, bestD = 144;
      lastDrawn.forEach(function (q) {
        var dx = q.sx - m.x, dy = q.sy - m.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = q; }
      });
      if (!best) return hideTip();
      hover = best.p;
      showTip(m, best.p);
    }
    function drawLegend(W) {
      var counts = Array.isArray(data.cluster_counts) ? data.cluster_counts.slice(0, 7) : [];
      if (!counts.length) return;
      var x = 14, y = 18;
      ctx.font = '11px JetBrains Mono, monospace';
      counts.forEach(function (r, i) {
        var k = Number(r.k);
        var label = (k < 0 ? 'unclustered' : 'L' + k) + ' ' + fmt(r.n || 0);
        if (x + ctx.measureText(label).width + 28 > W - 14) { x = 14; y += 18; }
        ctx.fillStyle = colorFor(k);
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x + 5, y - 3, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#aab3bf';
        ctx.globalAlpha = 0.85;
        ctx.fillText(label, x + 14, y);
        x += ctx.measureText(label).width + 34;
      });
      ctx.globalAlpha = 1;
    }
    function setScatter(next) { data = next || data; }
    function draw() {
      if (autoSpin) ay += 0.0028;
      var W = cv.clientWidth, H = cv.clientHeight;
      ctx.clearRect(0, 0, W, H);
      var cx = W * 0.5, cy = H * 0.5, scale = Math.min(W, H) * 0.34;
      ctx.strokeStyle = 'rgba(120,200,220,0.08)';
      ctx.lineWidth = 1;
      for (var ring = 1; ring <= 3; ring++) {
        ctx.beginPath(); ctx.arc(cx, cy, scale * ring / 3, 0, Math.PI * 2); ctx.stroke();
      }
      // axes
      var axes = [
        { p: { x: 1.1, y: 0, z: 0, k: -2 }, c: 'rgba(232,90,122,0.4)', l: 'PC1' },
        { p: { x: 0, y: 1.1, z: 0, k: -2 }, c: 'rgba(91,224,132,0.4)', l: 'PC2' },
        { p: { x: 0, y: 0, z: 1.1, k: -2 }, c: 'rgba(88,230,217,0.4)', l: 'PC3' },
      ];
      ctx.font = '10px JetBrains Mono, monospace';
      axes.forEach(function (a) {
        var e = project(a.p);
        ctx.strokeStyle = a.c; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + e.x * scale, cy - e.y * scale); ctx.stroke();
        ctx.fillStyle = a.c.replace('0.4', '0.85');
        ctx.fillText(a.l, cx + e.x * scale + 4, cy - e.y * scale - 2);
      });
      var pts = points().map(project);
      pts.sort(function (a, b) { return a.z - b.z; });
      lastDrawn = [];
      pts.forEach(function (q) {
        var px = cx + q.x * scale, py = cy - q.y * scale;
        var depth = (q.z + 1) / 2;
        ctx.fillStyle = colorFor(q.k);
        ctx.globalAlpha = 0.35 + depth * 0.55;
        var radius = 1.4 + depth * 3.2;
        ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
        lastDrawn.push({ sx: px, sy: py, r: radius, p: q.p });
      });
      if (hover) {
        var h = project(hover);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colorFor(hover.k);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(cx + h.x * scale, cy - h.y * scale, 8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      drawLegend(W);
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    startReplay('scatter', data, function (next) { setScatter(next); hideTip(); });
    cv.addEventListener('mousedown', function (e) { dragging = true; autoSpin = false; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; setTimeout(function () { autoSpin = true; }, 1500); } });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      ay += (e.clientX - lx) * 0.01; ax += (e.clientY - ly) * 0.01;
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('mousemove', updateHover);
    cv.addEventListener('mouseleave', hideTip);
    cv.addEventListener('touchstart', function (e) {
      dragging = true; autoSpin = false; var t = e.touches[0]; lx = t.clientX; ly = t.clientY;
    }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var t = e.touches[0];
      ay += (t.clientX - lx) * 0.01; ax += (t.clientY - ly) * 0.01;
      lx = t.clientX; ly = t.clientY;
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', function () { dragging = false; setTimeout(function () { autoSpin = true; }, 1500); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
      if (!document.hidden && !raf) raf = requestAnimationFrame(draw);
    });
  }

  // ── /graph — force layout, PageRank-sized nodes ─────────────────────────
  function startGraph() {
    var data = window.__GRAPH__;
    var svg = document.getElementById('g');
    if (!data || !svg) return;
    var tip = document.getElementById('graph-tip');
    if (!svg._slTipAttached) {
      svg._slTipAttached = true;
      svg.addEventListener('mousemove', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
        if (!t || !tip) return;
        var box = svg.getBoundingClientRect();
        tip.innerHTML = esc(t.getAttribute('data-tip') || '').replace(/\n/g, '<br>');
        tip.style.left = Math.max(0, Math.min(box.width - 260, e.clientX - box.left)) + 'px';
        tip.style.top = Math.max(0, Math.min(box.height - 90, e.clientY - box.top)) + 'px';
        tip.classList.remove('hidden');
      });
      svg.addEventListener('mouseleave', function () {
        if (tip) tip.classList.add('hidden');
      });
    }
    drawGraph(data);
    startReplay('graph', data, drawGraph);
  }

  function drawGraph(data) {
    var svg = document.getElementById('g');
    if (!data || !svg) return;
    var W = 1100, H = 600;
    var palette = ['#58e6d9', '#a78bff', '#f0a050', '#5be084', '#e85a7a', '#7ab8ff', '#d8c060'];
    var pos = {};
    var seed = 1;
    function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function shortLabel(s) {
      s = String(s || '');
      return s.length > 28 ? s.slice(0, 25) + '...' : s;
    }
    var nodes = Array.isArray(data.nodes) ? data.nodes.slice(0, 90) : [];
    if (!nodes.length) {
      svg.innerHTML = '<text x="16" y="44" font-family="JetBrains Mono" font-size="12" fill="#aab3bf">graph data unavailable</text>';
      return;
    }
    var keep = {};
    nodes.forEach(function (n) { keep[n.id] = true; });
    var edges = (Array.isArray(data.edges) ? data.edges : [])
      .filter(function (e) { return keep[e.s] && keep[e.o]; }).slice(0, 350);
    nodes.forEach(function (n) {
      pos[n.id] = {
        x: n.x === undefined ? rand() * (W - 80) + 40 : Number(n.x),
        y: n.y === undefined ? rand() * (H - 80) + 40 : Number(n.y),
        vx: 0,
        vy: 0
      };
    });
    if (nodes.length && nodes[0].x === undefined) {
      var k = 90;
      for (var it = 0; it < 240; it++) {
        for (var i = 0; i < nodes.length; i++)
          for (var j = i + 1; j < nodes.length; j++) {
            var a = pos[nodes[i].id], b = pos[nodes[j].id];
            var dx = a.x - b.x, dy = a.y - b.y;
            var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            var f = (k * k) / d;
            a.vx += (dx / d) * f * 0.0006; a.vy += (dy / d) * f * 0.0006;
            b.vx -= (dx / d) * f * 0.0006; b.vy -= (dy / d) * f * 0.0006;
          }
        edges.forEach(function (e) {
          var a = pos[e.s], b = pos[e.o];
          if (!a || !b) return;
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var f = (d * d) / k;
          a.vx += (dx / d) * f * 0.001; a.vy += (dy / d) * f * 0.001;
          b.vx -= (dx / d) * f * 0.001; b.vy -= (dy / d) * f * 0.001;
        });
        nodes.forEach(function (n) {
          var p = pos[n.id];
          p.vx += (W / 2 - p.x) * 0.005; p.vy += (H / 2 - p.y) * 0.005;
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.85; p.vy *= 0.85;
          p.x = Math.max(40, Math.min(W - 40, p.x));
          p.y = Math.max(30, Math.min(H - 30, p.y));
        });
      }
    }
    var maxScore = Math.max.apply(null, nodes.map(function (n) { return Number(n.score || 0); }));
    maxScore = maxScore || 1;
    var maxWeight = Math.max.apply(null, edges.map(function (e) { return Math.log1p(Number(e.w || 0)); }));
    if (!isFinite(maxWeight) || maxWeight <= 0) maxWeight = 1;
    var parts = [];
    parts.push('<rect width="' + W + '" height="' + H + '" fill="#050810"/>');
    parts.push('<circle cx="550" cy="300" r="250" fill="none" stroke="rgba(120,200,220,0.06)"/>');
    parts.push('<circle cx="550" cy="300" r="410" fill="none" stroke="rgba(120,200,220,0.04)"/>');
    edges.forEach(function (e) {
      var a = pos[e.s], b = pos[e.o];
      if (!a || !b) return;
      var stroke = e.bridge ? '#f0a050' :
                   e.p === 'is_a' ? 'rgba(167,139,255,0.55)' :
                   e.p === 'uses' ? 'rgba(88,230,217,0.55)' :
                   'rgba(232,90,122,0.45)';
      var w = (e.bridge ? 1.2 : 0.5) + (Math.log1p(Number(e.w || 0)) / maxWeight) * 2.4;
      var tip = e.s + ' - ' + e.p + ' -> ' + e.o + '\nweight ' + Number(e.w || 0).toFixed(2) +
        (e.bridge ? '\nbridge edge' : '');
      parts.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
                 '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
                 '" stroke="' + stroke + '" stroke-width="' + w.toFixed(2) +
                 '" stroke-linecap="round" data-tip="' + esc(tip) + '"><title>' +
                 esc(tip) + '</title></line>');
    });
    nodes.forEach(function (n) {
      var p = pos[n.id];
      var score = Number(n.score || 0);
      var r = 5 + Math.sqrt(score / maxScore) * 21;
      var comp = n.comp === undefined ? n.component : n.comp;
      var col = palette[(Number(comp || 0) % palette.length + palette.length) % palette.length];
      var label = Number(n.rank || 9999) <= 18 || nodes.length <= 32;
      var tip = n.id + '\nrank ' + n.rank + '\nscore ' + score.toFixed(4) +
        '\ncomponent ' + comp;
      parts.push('<g transform="translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')">' +
                 '<circle r="' + (r + 5).toFixed(1) + '" fill="' + col + '" fill-opacity="0.05"/>' +
                 '<circle r="' + r.toFixed(1) + '" fill="' + col + '" fill-opacity="0.18" stroke="' + col +
                 '" stroke-width="1.5" data-tip="' + esc(tip) + '"/>' +
                 (label ? '<text font-family="JetBrains Mono" font-size="9" fill="#e8ecf1" text-anchor="middle" dy="' +
                 (r + 13).toFixed(0) + '" style="paint-order:stroke;stroke:#050810;stroke-width:4px;stroke-linejoin:round">' +
                 esc(shortLabel(n.id)) + '</text>' : '') +
                 '<title>' + esc(tip) + '</title></g>');
    });
    svg.innerHTML = parts.join('');
  }

  // ── /heatmap ────────────────────────────────────────────────────────────
  var heatMode = 'matrix';
  var heatData = null;

  function startHeat() {
    var data = window.__HEAT__;
    var svg = document.getElementById('heat');
    if (!data || !svg) return;
    heatData = data;
    drawHeat(data);
    startReplay('heatmap', data, drawHeat);
    var zoom = document.getElementById('heat-zoom');
    var output = document.getElementById('heat-zoom-output');
    if (zoom) zoom.addEventListener('input', function () {
      applyHeatZoom(Number(zoom.value || 100), output);
    });
    document.querySelectorAll('[data-heat-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        heatMode = button.getAttribute('data-heat-mode') || 'matrix';
        document.querySelectorAll('[data-heat-mode]').forEach(function (candidate) {
          candidate.setAttribute('aria-pressed',
            candidate.getAttribute('data-heat-mode') === heatMode ? 'true' : 'false');
        });
        drawHeat(heatData);
      });
    });
  }

  function applyHeatZoom(percent, output) {
    var svg = document.getElementById('heat');
    if (!svg) return;
    var natural = Number(svg.getAttribute('data-natural-width') || 720);
    svg.style.width = Math.max(320, natural * percent / 100) + 'px';
    if (output) output.textContent = percent + '%';
  }

  function drawHeat(data) {
    // v5 note: drawHeat is reused by live heatmap and replay frames so the
    // current view and historical loop cannot drift apart visually.
    var svg = document.getElementById('heat');
    if (!data || !svg) return;
    var labels = Array.isArray(data.labels) ? data.labels : [];
    var M = Array.isArray(data.M) ? data.M : [];
    var n = labels.length;
    if (!n || M.length !== n) {
      svg.setAttribute('viewBox', '0 0 320 80');
      svg.innerHTML = '<text x="16" y="44" font-family="JetBrains Mono" font-size="12" fill="#aab3bf">heatmap data unavailable</text>';
      return;
    }
    for (var r0 = 0; r0 < n; r0++) {
      if (!Array.isArray(M[r0]) || M[r0].length !== n) {
        svg.setAttribute('viewBox', '0 0 320 80');
        svg.innerHTML = '<text x="16" y="44" font-family="JetBrains Mono" font-size="12" fill="#aab3bf">heatmap data unavailable</text>';
        return;
      }
    }
    heatData = data;
    if (heatMode === 'maze') {
      drawHeatMaze(labels, M);
      return;
    }
    var cell = n > 180 ? 8 : (n > 120 ? 10 : (n > 60 ? 14 : (n > 36 ? 20 : 36)));
    var pad = n > 120 ? 48 : (n > 60 ? 56 : 64);
    var natural = pad + n * cell + 20;
    var labelStride = n > 200 ? 8 : (n > 140 ? 6 : (n > 90 ? 4 : (n > 60 ? 2 : 1)));
    svg.setAttribute('viewBox', '0 0 ' + natural + ' ' + natural);
    svg.setAttribute('data-natural-width', String(natural));
    var zoom = document.getElementById('heat-zoom');
    applyHeatZoom(Number(zoom && zoom.value || 100), document.getElementById('heat-zoom-output'));
    var max = 0;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var mv = Number(M[i][j] || 0);
      if (mv > max) max = mv;
    }
    if (max === 0) max = 1;
    var parts = [];
    for (var i2 = 0; i2 < n; i2++) {
      var labelText = 'L' + esc(labels[i2]);
      if (i2 % labelStride === 0) {
        parts.push('<text x="' + (pad - 6) + '" y="' + (pad + i2 * cell + cell / 2 + 4) +
                   '" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#aab3bf">' + labelText + '</text>');
        parts.push('<text x="' + (pad + i2 * cell + cell / 2) + '" y="' + (pad - 6) +
                   '" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#aab3bf">' + labelText + '</text>');
      }
    }
    for (var i3 = 0; i3 < n; i3++) for (var j3 = 0; j3 < n; j3++) {
      var v = Math.max(0, Number(M[i3][j3] || 0));
      var t = v / max;
      var fill = v === 0 ? '#0a0e14' : 'rgba(88,230,217,' + (0.08 + t * 0.85).toFixed(2) + ')';
      parts.push('<rect x="' + (pad + j3 * cell) + '" y="' + (pad + i3 * cell) +
                 '" width="' + (cell - 2) + '" height="' + (cell - 2) +
                 '" fill="' + fill + '"><title>L' + esc(labels[i3]) + ' ↔ L' + esc(labels[j3]) + ' · ' + v + '</title></rect>');
      if (t > 0.5 && cell >= 20) {
        parts.push('<text x="' + (pad + j3 * cell + cell / 2) + '" y="' + (pad + i3 * cell + cell / 2 + 4) +
                   '" text-anchor="middle" font-family="JetBrains Mono" font-size="9" font-weight="700" fill="#050810">' + v + '</text>');
      }
    }
    svg.innerHTML = parts.join('');
  }

  function drawHeatMaze(labels, M) {
    var svg = document.getElementById('heat');
    var n = labels.length;
    var cols = Math.ceil(Math.sqrt(n));
    var rows = Math.ceil(n / cols);
    var cell = n > 180 ? 30 : (n > 100 ? 36 : 48);
    var pad = 36;
    var width = pad * 2 + cols * cell;
    var height = pad * 2 + rows * cell;
    var visited = new Array(n).fill(false);
    var best = new Array(n).fill(-1);
    var parent = new Array(n).fill(-1);
    best[0] = 0;
    for (var step = 0; step < n; step++) {
      var node = -1;
      for (var pick = 0; pick < n; pick++) {
        if (!visited[pick] && (node < 0 || best[pick] > best[node])) node = pick;
      }
      if (node < 0) break;
      visited[node] = true;
      for (var next = 0; next < n; next++) {
        var weight = Number(M[node][next] || 0);
        if (!visited[next] && weight > best[next]) {
          best[next] = weight;
          parent[next] = node;
        }
      }
    }
    function point(index) {
      var row = Math.floor(index / cols);
      var logical = index % cols;
      var col = row % 2 ? cols - logical - 1 : logical;
      return { x: pad + col * cell + cell / 2, y: pad + row * cell + cell / 2 };
    }
    var max = Math.max.apply(null, best.concat([1]));
    var parts = [];
    for (var edge = 1; edge < n; edge++) {
      var from = point(parent[edge] < 0 ? edge - 1 : parent[edge]);
      var to = point(edge);
      var middle = (from.x + to.x) / 2;
      var strength = Math.max(0, Number(best[edge] || 0)) / max;
      parts.push('<path d="M' + from.x + ' ' + from.y + 'H' + middle +
                 'V' + to.y + 'H' + to.x + '" fill="none" stroke="' +
                 (strength > 0.5 ? '#58e6d9' : '#536070') +
                 '" stroke-width="' + (1.5 + strength * 4).toFixed(1) +
                 '" stroke-linecap="round"><title>L' +
                 esc(labels[parent[edge] < 0 ? edge - 1 : parent[edge]]) +
                 ' ↔ L' + esc(labels[edge]) + ' · ' +
                 Math.max(0, Number(best[edge] || 0)) + '</title></path>');
    }
    var stride = n > 160 ? 8 : (n > 80 ? 4 : (n > 40 ? 2 : 1));
    for (var i = 0; i < n; i++) {
      var p = point(i);
      parts.push('<rect x="' + (p.x - cell * 0.28).toFixed(1) +
                 '" y="' + (p.y - cell * 0.28).toFixed(1) +
                 '" width="' + (cell * 0.56).toFixed(1) +
                 '" height="' + (cell * 0.56).toFixed(1) +
                 '" rx="2" fill="#111923" stroke="' +
                 (i === 0 ? '#5be084' : (i === n - 1 ? '#f0a050' : '#58e6d9')) +
                 '"><title>L' + esc(labels[i]) + '</title></rect>');
      if (i % stride === 0) {
        parts.push('<text x="' + p.x + '" y="' + (p.y + 3) +
                   '" text-anchor="middle" font-family="JetBrains Mono" font-size="8" fill="#e8ecf1">L' +
                   esc(labels[i]) + '</text>');
      }
    }
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('data-natural-width', String(width));
    applyHeatZoom(Number(document.getElementById('heat-zoom').value || 100),
                  document.getElementById('heat-zoom-output'));
    svg.innerHTML = parts.join('');
  }

  // ── /monitor ────────────────────────────────────────────────────────────
  function startMonitor() {
    var data = window.__MONITOR__;
    if (!data || !document.getElementById('monitor-state')) return;
    renderMonitor(data);
    var replayBox = document.querySelector('[data-replay="ingestion"]');
    startReplay(replayBox ? 'ingestion' : 'monitor', data, renderMonitor);
  }

  function renderMonitor(data) {
    drawTimeSeries('monitor-queue', data.queue && data.queue.series || [], [
      { key: 'active', label: 'active', color: '#58e6d9' },
      { key: 'incoming', label: 'incoming', color: '#a78bff' },
      { key: 'processed', label: 'processed', color: '#5be084' }
    ]);
    var qc = data.queue && data.queue.counts || {};
    setMonitorMeta('queue', ['queued ' + fmt(qc.queued || 0), 'done ' + fmt(qc.done || 0),
      'published ' + fmt(qc.published || 0), 'failed ' + fmt(qc.failed || 0)]);
    renderController(data.controller || {});
    drawBars('monitor-waterfall', data.waterfall || [], 'stage', 'n', '#58e6d9');
    setMonitorMeta('waterfall', (data.waterfall || []).slice(-3).map(function (r) {
      return r.stage + ' ' + fmt(r.n || 0);
    }));
    drawTimeSeries('monitor-velocity', data.velocity || [], [
      { key: 'api', label: 'api', color: '#a78bff' },
      { key: 'ingested', label: 'ingested', color: '#5be084' }
    ]);
    setMonitorMeta('velocity', ['api ' + fmt(sumRows(data.velocity || [], 'api')),
      'ingested ' + fmt(sumRows(data.velocity || [], 'ingested'))]);
    drawTimeSeries('monitor-drift', data.drift && data.drift.series || [], [
      { key: 'avg', label: 'avg', color: '#58e6d9' },
      { key: 'max', label: 'max', color: '#f0a050' }
    ]);
    var driftLast = lastRow(data.drift && data.drift.series || []);
    setMonitorMeta('drift', ['labels ' + fmt(driftLast.labels || 0),
      'avg ' + Number(driftLast.avg || 0).toFixed(3), 'max ' + Number(driftLast.max || 0).toFixed(3)]);
    drawBars('monitor-rules', data.rules && data.rules.score_bins || [], 'label', 'n', '#a78bff');
    setMonitorMeta('rules', ['rules ' + fmt(data.rules && data.rules.rules || 0),
      'beliefs ' + fmt(data.rules && data.rules.beliefs || 0)]);
    drawTimeSeries('monitor-bridges', data.bridges && data.bridges.series || [], [
      { key: 'entities', label: 'entities', color: '#58e6d9' },
      { key: 'components', label: 'components', color: '#a78bff' },
      { key: 'bridges', label: 'bridges', color: '#f0a050' }
    ]);
    var bridgeLast = lastRow(data.bridges && data.bridges.series || []);
    setMonitorMeta('bridges', ['entities ' + fmt(bridgeLast.entities || 0),
      'components ' + fmt(bridgeLast.components || 0), 'bridges ' + fmt(bridgeLast.bridges || 0)]);
    renderMonitorTables(data);
  }

  function renderController(controller) {
    var root = document.querySelector('[data-controller-state]');
    if (!root) return;
    var eta = controller.estimated_minutes_to_zero;
    var rows = [
      ['selected', fmt(controller.limit || 0)],
      ['required', fmt(controller.required_limit || 0)],
      ['keep up', fmt(controller.keep_up_cap || 0)],
      ['surplus', fmt(controller.surplus_cap || 0)],
      ['horizon', controller.horizon_mode || 'unknown'],
      ['zero ETA', eta === null || eta === undefined ? 'unavailable' : fmt(eta) + ' min'],
      ['path to zero', controller.has_path_to_zero ? 'yes' : 'no']
    ];
    root.innerHTML = rows.map(function (row) {
      return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
    }).join('');
  }

  function startStorage() {
    var data = window.__STORAGE__;
    if (!data || !document.getElementById('storage-state')) return;
    startReplay('storage', data, renderStorage);
  }

  function renderStorage(data) {
    var root = document.getElementById('storage-state');
    if (!root) return;
    var active = data.active_counts || {};
    var queue = data.queue_counts || {};
    var archives = data.archive_manifest || [];
    var rows = archives.map(function (r) {
      return '<tr><td>' + esc(r.year || '') + '</td><td>' + fmt(r.item_count || 0) +
        '</td><td>' + fmt(r.embedding_count || 0) + '</td><td>' +
        esc(r.restore_status || '') + '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="cards"><div class="card"><h3>active corpus</h3><dl class="kv">' +
      '<dt>items</dt><dd>' + fmt(active.items || 0) + '</dd>' +
      '<dt>embeddings</dt><dd>' + fmt(active.embeddings || 0) + '</dd>' +
      '<dt>rules</dt><dd>' + fmt(active.rules || 0) + '</dd>' +
      '<dt>queue</dt><dd>' + fmt(active.queue || 0) + '</dd></dl></div>' +
      '<div class="card"><h3>storage</h3><dl class="kv">' +
      '<dt>database</dt><dd>' + fmtBytes(data.db_bytes || 0) + '</dd>' +
      '<dt>disk free</dt><dd>' + fmtBytes(data.disk_free_bytes || 0) + '</dd>' +
      '<dt>disk used</dt><dd>' + pct(data.disk_used_ratio || 0) + '</dd>' +
      '<dt>queued</dt><dd>' + fmt(queue.queued || 0) + '</dd></dl></div></div>' +
      '<div class="card table-card"><h3>corpus archives</h3>' +
      (rows ? table(['year', 'items', 'embeddings', 'restore'], rows) :
        '<p class="muted">no corpus archives yet</p>') + '</div>';
  }

  function fmtBytes(n) {
    var value = Number(n || 0), units = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return (i ? value.toFixed(2) : Math.round(value)) + ' ' + units[i];
  }

  function setMonitorMeta(key, parts) {
    var root = document.querySelector('[data-monitor-meta-' + key + ']');
    if (!root) return;
    root.innerHTML = (parts || []).map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('');
  }

  function sumRows(rows, key) {
    return (rows || []).reduce(function (a, r) { return a + Number(r[key] || 0); }, 0);
  }

  function lastRow(rows) {
    return rows && rows.length ? rows[rows.length - 1] : {};
  }

  function canvasCtx(id) {
    var cv = document.getElementById(id);
    if (!cv) return null;
    var ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.floor(r.width * dpr));
    cv.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cv: cv, ctx: ctx, W: r.width, H: r.height };
  }

  function chartFrame(ctx, W, H, titleMax) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,200,220,0.08)';
    ctx.lineWidth = 1;
    for (var i = 1; i <= 4; i++) {
      var y = 22 + (H - 48) * i / 4;
      ctx.beginPath(); ctx.moveTo(42, y); ctx.lineTo(W - 16, y); ctx.stroke();
    }
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = '#6b7684';
    ctx.fillText(fmt(titleMax || 0), 8, 28);
    ctx.fillText('0', 26, H - 22);
  }

  function drawLegend(ctx, fields, x, y) {
    ctx.font = '10px JetBrains Mono, monospace';
    fields.forEach(function (f) {
      ctx.fillStyle = f.color;
      ctx.fillRect(x, y - 7, 8, 8);
      ctx.fillStyle = '#aab3bf';
      ctx.fillText(f.label, x + 12, y);
      x += ctx.measureText(f.label).width + 32;
    });
  }

  function drawTimeSeries(id, rows, fields) {
    var c = canvasCtx(id);
    if (!c) return;
    var ctx = c.ctx, W = c.W, H = c.H;
    rows = Array.isArray(rows) ? rows : [];
    var max = 0;
    rows.forEach(function (r) {
      fields.forEach(function (f) { max = Math.max(max, Number(r[f.key] || 0)); });
    });
    max = max || 1;
    chartFrame(ctx, W, H, max);
    var left = 42, right = W - 16, top = 22, bottom = H - 28;
    fields.forEach(function (f) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      rows.forEach(function (r, i) {
        var x = left + (right - left) * (rows.length <= 1 ? 0 : i / (rows.length - 1));
        var y = bottom - (bottom - top) * (Number(r[f.key] || 0) / max);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    drawLegend(ctx, fields, 48, 14);
    if (rows.length) {
      ctx.fillStyle = '#6b7684';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(rows[0].t || '', left, H - 8);
      var last = rows[rows.length - 1].t || '';
      ctx.fillText(last, Math.max(left, right - ctx.measureText(last).width), H - 8);
    }
  }

  function drawBars(id, rows, labelKey, valueKey, color) {
    var c = canvasCtx(id);
    if (!c) return;
    var ctx = c.ctx, W = c.W, H = c.H;
    rows = Array.isArray(rows) ? rows : [];
    var max = rows.reduce(function (m, r) { return Math.max(m, Number(r[valueKey] || 0)); }, 0) || 1;
    chartFrame(ctx, W, H, max);
    var left = 42, right = W - 16, bottom = H - 34, top = 24;
    var gap = 8, bw = Math.max(6, ((right - left) - gap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length));
    ctx.font = '10px JetBrains Mono, monospace';
    rows.forEach(function (r, i) {
      var v = Number(r[valueKey] || 0);
      var h = (bottom - top) * (v / max);
      var x = left + i * (bw + gap);
      var y = bottom - h;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(x, y, bw, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#aab3bf';
      var label = String(r[labelKey] || '');
      if (label.length > 10) label = label.slice(0, 9);
      ctx.save();
      ctx.translate(x + bw / 2, H - 8);
      ctx.rotate(-Math.PI / 8);
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
  }

  function renderMonitorTables(data) {
    var root = document.getElementById('monitor-runs');
    if (!root) return;
    var runs = (data.recent_runs || []).map(function (r) {
      var ok = Number(r.exit_code) === 0;
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.stage) + '</td><td>' +
        esc(r.started_at || '') + '</td><td class="exit-cell"><span class="tag ' + (ok ? 'ok' : 'bad') + '">' +
        (ok ? 'ok' : 'fail') + '</span></td></tr>';
    }).join('');
    var topRules = ((data.rules && data.rules.top) || []).map(function (r) {
      return '<tr><td>' + esc((r.a || []).join(' & ')) + '</td><td>' +
        esc((r.c || []).join(' & ')) + '</td><td>' + Number(r.score || 0).toFixed(2) +
        '</td><td>' + fmt(r.support || 0) + '/' + fmt(r.antecedent || 0) + '</td></tr>';
    }).join('');
    var drift = ((data.drift && data.drift.top) || []).map(function (r) {
      return '<tr><td><code>L' + esc(r.label) + '</code></td><td>' +
        Number(r.drift || 0).toFixed(3) + '</td><td>' + fmt(r.size || 0) + '</td></tr>';
    }).join('');
    var bridges = ((data.bridges && data.bridges.top) || []).map(function (r) {
      return '<tr><td>' + esc(r.subj || '') + '</td><td>' + esc(r.obj || '') + '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="cards"><div class="table-card">' + table(['run', 'stage', 'started', 'exit'], runs) +
      '</div><div class="table-card">' + table(['if', 'then', 'score', 'evidence'], topRules) +
      '</div><div class="table-card">' + table(['cluster', 'drift', 'size'], drift) +
      '</div><div class="table-card">' + table(['bridge from', 'bridge to'], bridges) + '</div></div>';
  }

  function startReplay(kind, liveData, render) { return; }

  function fmt(n) { return Number(n || 0).toLocaleString(); }
  function pct(n) { return (Number(n || 0) * 100).toFixed(1) + '%'; }
  function miniLine(values, color) {
    values = (values || []).slice(-80);
    if (!values.length) values = [0];
    var w = 320, h = 92, pad = 10;
    var max = values.reduce(function (m, v) { return Math.max(m, Number(v || 0)); }, 0) || 1;
    var pts = values.map(function (v, i) {
      var x = pad + (w - pad * 2) * (values.length <= 1 ? 0 : i / (values.length - 1));
      var y = h - pad - ((Number(v || 0) / max) * (h - pad * 2));
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="mini-chart" viewBox="0 0 ' + w + ' ' + h + '" role="img">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color +
      '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
      '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) +
      '" y2="' + (h - pad) + '" stroke="#3a4554" stroke-width="1"/></svg>';
  }
  function table(headers, rows) {
    return '<table><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
           '</tr>' + rows + '</table>';
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  }); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  function boot() {
    startAutoRefresh();
    startSse();
    startSearch();
    startOverview();
    startSources();
    startSimpleTables();
    startScatter();
    startGraph();
    startHeat();
    startMonitor();
    startStorage();
  }
})();
