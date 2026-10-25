/* Local controls operate only on the rows delivered in this sealed snapshot. */
(function () {
  'use strict';

  function initTables(scope) {
    scope.querySelectorAll('[data-epoch-table]').forEach(function (box) {
      if (box.dataset.epochTableReady) return;
      box.dataset.epochTableReady = '1';
      const rows = Array.from(box.querySelectorAll('tbody tr'));
      const input = box.querySelector('[data-epoch-filter]');
      const previous = box.querySelector('[data-page-prev]');
      const next = box.querySelector('[data-page-next]');
      const status = box.querySelector('[data-page-status]');
      const size = Math.max(1, Math.min(500, Number(box.dataset.pageSize) || 50));
      const text = rows.map(function (row) { return row.textContent.toLocaleLowerCase(); });
      let page = 0;
      function update() {
        const query = (input && input.value || '').trim().toLocaleLowerCase();
        const matching = rows.map(function (_, index) { return index; })
          .filter(function (index) { return !query || text[index].includes(query); });
        page = Math.min(page, Math.max(0, Math.ceil(matching.length / size) - 1));
        const visible = new Set(matching.slice(page * size, (page + 1) * size));
        rows.forEach(function (row, index) { row.hidden = !visible.has(index); });
        if (previous) previous.disabled = page === 0;
        if (next) next.disabled = (page + 1) * size >= matching.length;
        if (status) status.textContent = (matching.length ? page * size + 1 : 0) + '\u2013' +
          Math.min((page + 1) * size, matching.length) + ' of ' + matching.length +
          (query ? ' matching / ' + rows.length : '') + ' recorded rows';
      }
      if (input) input.addEventListener('input', function () { page = 0; update(); });
      if (previous) previous.addEventListener('click', function (event) {
        event.preventDefault(); page = Math.max(0, page - 1); update();
      });
      if (next) next.addEventListener('click', function (event) {
        event.preventDefault(); page += 1; update();
      });
      update();
    });
  }

  function initEntities(scope) {
    scope.querySelectorAll('[data-entity-limit]').forEach(function (input) {
      if (input.dataset.entityLimitReady) return;
      input.dataset.entityLimitReady = '1';
      const box = input.closest('[data-epoch-entities]') || scope.querySelector('[data-epoch-entities]');
      if (!box) return;
      const rows = Array.from(box.querySelectorAll('tbody tr'));
      const output = box.querySelector('[data-entity-output]') || scope.querySelector('[data-entity-output]');
      function update() {
        const limit = Math.max(8, Math.min(16, Number(input.value) || 8));
        rows.forEach(function (row, index) { row.hidden = index >= limit; });
        if (output) output.textContent = String(limit);
      }
      input.addEventListener('input', update);
      input.addEventListener('change', update);
      update();
    });
  }

  function initSelectors(scope) {
    scope.querySelectorAll('[data-epoch-select]').forEach(function (select) {
      if (select.dataset.epochSelectReady) return;
      select.dataset.epochSelectReady = '1';
      select.addEventListener('change', function () {
        if (!select.value) return;
        if (window.parent !== window) {
          window.parent.postMessage({streamlearnNavigate: select.value}, '*');
        } else {
          const target = new URL(select.value, location.href);
          if (target.origin === location.origin) location.assign(target.href);
        }
      });
    });
  }

  function init(scope) {
    scope = scope || document;
    initTables(scope); initEntities(scope); initSelectors(scope);
  }

  function watchHead() {
    const params = new URLSearchParams(location.search);
    if (window.parent !== window || params.has('epoch') || params.get('replay') === '1' ||
        location.pathname.includes('/pages/') || location.pathname.includes('/epochs/')) return;
    const current = document.querySelector('[data-learning-epoch]');
    if (!current) return;
    let timer, stopped = false, request;
    async function check() {
      if (stopped) return;
      if (!document.hidden) {
        request = new AbortController();
        const timeout = window.setTimeout(function () { request.abort(); }, 8000);
        try {
          const response = await fetch('/epochs/head', {cache: 'no-store', signal: request.signal});
          if (!response.ok) throw Error('head unavailable');
          const head = await response.json();
          if (head.status === 'sealed' && /^[a-f0-9]{64}$/.test(head.epoch_id || '') &&
              head.epoch_id !== current.dataset.learningEpoch) {
            let notice = document.querySelector('[data-epoch-update]');
            if (!notice) {
              notice = document.createElement('p');
              notice.className = 'card'; notice.dataset.epochUpdate = '1';
              notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
              current.before(notice);
            }
            const link = document.createElement('a'), target = new URL(location.href);
            target.searchParams.set('epoch', head.epoch_id);
            target.searchParams.delete('run_id'); target.searchParams.delete('replay');
            link.href = target.href; link.textContent = 'Open newly verified epoch';
            notice.replaceChildren(document.createTextNode('New learning evidence is available. '), link);
          }
        } catch (_) { /* Preserve the displayed epoch when observation fails. */ }
        finally { window.clearTimeout(timeout); }
      }
      if (!stopped) timer = window.setTimeout(check, 30000);
    }
    timer = window.setTimeout(check, 30000);
    window.addEventListener('pagehide', function () {
      stopped = true; window.clearTimeout(timer); if (request) request.abort();
    }, {once: true});
  }

  window.StreamlearnDashboard = {init: init};
  function boot() { init(document); watchHead(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
