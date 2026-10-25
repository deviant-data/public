/* Verified bytes are the rendered bytes. No second page/asset network read. */
(async function () {
  const frame = document.querySelector('iframe'), status = document.getElementById('status');
  const root = new URL('.', location.href), decoder = new TextDecoder(), contexts = new Map();
  const storageKey = 'streamlearn-last-verified:' + root.href;
  let active = null, sequence = 0, offered = null;
  async function hash(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function checked(url, expected) {
    if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('missing digest');
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok) throw Error('unavailable');
    const bytes = await response.arrayBuffer();
    if (await hash(bytes) !== expected) throw Error('integrity');
    return bytes;
  }
  function pathOK(path) { return typeof path === 'string' && !path.startsWith('/') && !path.includes('..') && !path.includes('\\'); }
  async function load(head) {
    if (!head || !/^epochs\/[a-f0-9]{64}$/.test(head.path) || head.path !== 'epochs/' + head.epoch_id) throw Error('invalid head');
    const key = head.epoch_id + ':' + head.manifest_sha256;
    if (contexts.has(key)) return contexts.get(key);
    const base = new URL(head.path + '/', root), cache = new Map();
    const manifest = JSON.parse(decoder.decode(await checked(new URL('bundle.json', base), head.manifest_sha256)));
    if (!manifest.complete || manifest.epoch_id !== head.epoch_id) throw Error('incomplete');
    async function member(path) {
      if (!pathOK(path) || !Object.hasOwn(manifest.files, path)) throw Error('unlisted member');
      if (!cache.has(path)) cache.set(path, await checked(new URL(path, base), manifest.files[path]));
      return cache.get(path);
    }
    try {
      const required = new Set(manifest.required_files || Object.keys(manifest.files));
      for (const path of ['pages/overview.html', 'state/latest.json', 'static/sl.js']) required.add(path);
      for (const path of required) await member(path);
      const context = {head, base, manifest, member};
      contexts.set(key, context);
      if (contexts.size > 4) contexts.delete(contexts.keys().next().value);
      return context;
    } catch (error) { error.previous = manifest.previous || head.previous; throw error; }
  }
  async function select(head) {
    const seen = new Set();
    for (let attempts = 0; head && attempts < 64; attempts++) {
      if (seen.has(head.epoch_id)) throw Error('cyclic fallback');
      seen.add(head.epoch_id);
      try { return await load(head); }
      catch (error) { head = error.previous || head.previous; }
    }
    throw Error('no complete epoch in bounded fallback search');
  }
  function localPath(url, context) {
    const parsed = new URL(url, context.base);
    if (parsed.origin !== context.base.origin || !parsed.pathname.startsWith(context.base.pathname)) throw Error('outside epoch');
    return decodeURIComponent(parsed.pathname.slice(context.base.pathname.length));
  }
  async function render(path, context = active) {
    const token = ++sequence, pageURL = new URL(path, context.base);
    const doc = new DOMParser().parseFromString(decoder.decode(await context.member(path)), 'text/html');
    doc.querySelectorAll('base').forEach(node => node.remove());
    for (const script of doc.querySelectorAll('script[src]')) {
      const asset = localPath(new URL(script.getAttribute('src'), pageURL), context);
      script.removeAttribute('src'); script.removeAttribute('integrity');
      script.textContent = decoder.decode(await context.member(asset)).replace(/<\/script/gi, '<\\/script');
    }
    for (const link of doc.querySelectorAll('link[rel=stylesheet]')) {
      const style = doc.createElement('style');
      style.textContent = decoder.decode(await context.member(localPath(new URL(link.getAttribute('href'), pageURL), context)));
      link.replaceWith(style);
    }
    for (const image of doc.querySelectorAll('img[src]')) {
      const asset = localPath(new URL(image.getAttribute('src'), pageURL), context);
      const bytes = await context.member(asset), type = asset.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      let binary = ''; const octets = new Uint8Array(bytes);
      for(let i=0;i<octets.length;i+=32768) binary += String.fromCharCode(...octets.subarray(i,i+32768));
      image.setAttribute('src', 'data:' + type + ';base64,' + btoa(binary));
      image.removeAttribute('srcset');
    }
    for (const node of doc.querySelectorAll('iframe,object,embed,link[rel=preload],link[rel=prefetch]')) node.remove();
    const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    doc.head.prepend(policy);
    const bridge = doc.createElement('script');
    bridge.textContent = "document.addEventListener('click',e=>{const a=e.target.closest('a');if(a){e.preventDefault();parent.postMessage({streamlearnNavigate:a.getAttribute('href')},'*')}});document.addEventListener('submit',e=>e.preventDefault());";
    doc.head.prepend(bridge);
    if (token !== sequence) return;
    active = context; active.pageURL = pageURL;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
    frame.hidden = false;
  }
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow || !active || typeof event.data?.streamlearnNavigate !== 'string') return;
    try {
      const target = new URL(event.data.streamlearnNavigate, active.pageURL);
      const path = localPath(target, active);
      if (path.endsWith('.html') && path.startsWith('pages/')) { await render(path); return; }
      if (path === 'claims/index.json') { await claims(target.searchParams.get('claim'), Number(target.searchParams.get('page') || 0)); return; }
      if (/^windows\/[a-f0-9]{64}\/index\.json$/.test(path)) { await windowEvidence(path, Number(target.searchParams.get('page') || 0)); return; }
      if (path === 'provenance/index.html') { await provenance(Number(target.searchParams.get('page') || 0)); return; }
      if (path.endsWith('.json')) {
        const value = decoder.decode(await active.member(path));
        const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
        frame.srcdoc = '<!doctype html><meta charset=utf-8><pre>' + escaped + '</pre>'; return;
      }
      throw Error('unsupported member');
    } catch (_) {
      // Historical selection follows only the authenticated previous-head chain.
      try {
        const target = new URL(event.data.streamlearnNavigate, active.pageURL);
        const prefix = root.pathname + 'epochs/';
        const match = target.origin === root.origin && target.pathname.startsWith(prefix) &&
          target.pathname.slice(prefix.length).match(/^([a-f0-9]{64})\/(pages\/[a-z0-9_-]+\.html)$/);
        if (match) {
          let cursor = active;
          const seen = new Set([cursor.head.epoch_id]);
          for (let attempts = 0; cursor.manifest.previous && attempts < 64; attempts++) {
            const previous = cursor.manifest.previous;
            if (seen.has(previous.epoch_id)) break;
            seen.add(previous.epoch_id); cursor = await load(previous);
            if (cursor.head.epoch_id === match[1]) {
              await render(match[2], cursor); return;
            }
          }
        }
      } catch (_) {}
      status.textContent = 'Requested evidence is unavailable or failed verification. The pinned epoch is unchanged.';
    }
  });
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  function evidenceFrame(title, body, path) {
    active.pageURL = new URL(path, active.base);
    frame.srcdoc = '<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'"><style>body{font:16px system-ui;background:#10151c;color:#e6edf3;padding:1rem}td,th{padding:.5rem;text-align:left;overflow-wrap:anywhere}a{color:#72d5ff}a:focus{outline:2px solid #72d5ff}nav a{margin-right:1rem}</style><h1>' + esc(title) + '</h1><p>Exact sealed epoch ' + esc(active.head.epoch_id.slice(0,12)) + '</p><nav><a href="' + esc(new URL('pages/rules.html',active.base)) + '">Observed relationships</a><a href="' + esc(new URL('pages/sequences.html',active.base)) + '">Later outcomes</a></nav>' + body + '<script>document.addEventListener("click",e=>{const a=e.target.closest("a");if(a){e.preventDefault();parent.postMessage({streamlearnNavigate:a.getAttribute("href")},"*")}})<\/script>';
  }
  function pager(index, length, href) {
    return '<p>Page ' + (index+1) + ' of ' + length + '</p><nav>' + (index ? '<a href="' + esc(href(index-1)) + '">Previous evidence page</a>' : '') + (index+1<length ? '<a href="' + esc(href(index+1)) + '">Next evidence page</a>' : '') + '</nav>';
  }
  async function provenance(index) {
    const token = ++sequence;
    const listing = JSON.parse(decoder.decode(await active.member('provenance/index.json')));
    const entry = listing.pages[index]; if (!entry) throw Error('missing provenance page');
    const value = JSON.parse(decoder.decode(await active.member('provenance/' + entry.path)));
    const identities = value.refs.map(r => ({source_object_id:r.source_object_id, source_revision_id:r.source_revision_id}));
    if (value.refs.length > 256 || value.page_id !== entry.page_id || await hash(new TextEncoder().encode(JSON.stringify(identities))) !== entry.page_id) throw Error('provenance mismatch');
    const rows = value.refs.map(r => '<tr>' + ['source_name','external_id','source_revision_id','source_ts'].map(k => '<td>' + esc(r[k]) + '</td>').join('') + '</tr>').join('');
    if(token !== sequence) return;
    evidenceFrame('Source evidence', '<p>' + listing.total_revisions + ' exact source revisions</p>' + pager(index,listing.pages.length,i=>'index.html?page='+i) + '<table><tr><th>Source</th><th>External identifier</th><th>Revision</th><th>Evidence time</th></tr>' + rows + '</table>', 'provenance/index.html');
  }
  async function claims(claim, index) {
    if(!/^[a-f0-9]{64}$/.test(claim || '') || !Number.isInteger(index) || index<0) throw Error('invalid claim');
    const token = ++sequence, listing = JSON.parse(decoder.decode(await active.member('claims/index.json')));
    const pages = listing.pages.filter(p=>p.claim_id===claim), entry=pages[index];
    if(!entry) throw Error('missing claim page');
    const value=JSON.parse(decoder.decode(await active.member('claims/'+entry.page_id+'.json')));
    if(value.claim_id!==claim || value.page_id!==entry.page_id || value.rows.length>256) throw Error('claim mismatch');
    const rows=value.rows.map(r=>'<tr><td>' + (r.window_revision_id ? '<a href="../windows/'+esc(r.window_revision_id)+'/index.json">'+esc(r.window_revision_id.slice(0,12))+'…</a>' : esc(r.source_revision_id)) + '</td><td>'+esc(r.antecedent ?? 'source witness')+'</td><td>'+esc(r.support ?? '')+'</td></tr>').join('');
    if(token!==sequence)return;
    evidenceFrame('Claim evidence', '<p>Claim '+esc(claim)+'</p><p>Each immutable window links to exact source revision membership. Eligible and supported are recorded outcomes, not causal conclusions.</p>'+pager(index,pages.length,i=>'index.json?claim='+claim+'&page='+i)+'<table><tr><th>Window revision / source witness</th><th>Eligible</th><th>Supported</th></tr>'+rows+'</table>', 'claims/index.json');
  }
  async function windowEvidence(path,index) {
    if(!Number.isInteger(index)||index<0)throw Error('invalid window page');
    const token=++sequence,listing=JSON.parse(decoder.decode(await active.member(path))),entry=listing.pages[index];
    if(!entry)throw Error('missing window membership');
    const value=JSON.parse(decoder.decode(await active.member(path.replace('index.json',entry.path))));
    if(value.window_revision_id!==listing.window_revision_id||value.refs.length>256)throw Error('window mismatch');
    const rows=value.refs.map(r=>'<tr><td>'+esc(r.source_object_id)+'</td><td>'+esc(r.source_revision_id)+'</td></tr>').join('');
    if(token!==sequence)return;
    evidenceFrame('Historical window membership','<p>'+listing.total_members+' exact source revisions. Raw source payloads remain private.</p>'+pager(index,listing.pages.length,i=>'index.json?page='+i)+'<table><tr><th>Source object</th><th>Source revision</th></tr>'+rows+'</table>',path);
  }
  function remember(context) {
    try { localStorage.setItem(storageKey, JSON.stringify(context.head)); } catch (_) {}
  }
  function offer(context) {
    if (offered === context) return;
    offered = context;
    status.textContent = 'A newer complete epoch has been verified. The displayed evidence is unchanged. ';
    const link = document.createElement('a');
    link.href = '#latest-verified'; link.textContent = 'Open latest verified epoch';
    link.addEventListener('click', async event => {
      event.preventDefault();
      const next = offered;
      if (!next) return;
      const path = active?.pageURL && localPath(active.pageURL, active);
      const selected = path && path.startsWith('pages/') && next.manifest.files[path] ? path : 'pages/overview.html';
      try {
        await render(selected, next); offered = null; remember(next);
        status.textContent = 'Verified learning views. Evidence is checked when opened.';
      } catch (_) { status.textContent = 'The newer epoch could not be opened. Previous evidence has not been replaced.'; }
    });
    status.appendChild(link);
  }
  async function readHead() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller && window.setTimeout?.(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL('head.json', root), {cache: 'no-store', ...(controller ? {signal: controller.signal} : {})});
      if (!response.ok) throw Error('head unavailable');
      return await response.json();
    } finally { if (timeout) window.clearTimeout(timeout); }
  }
  async function refresh(initial = false) {
    let head, context;
    try {
      head = await readHead(); context = await select(head);
    } catch (_) {
      if (!initial || active) return;
      try { context = await load(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
      catch (_) { status.textContent = 'No complete verified epoch is available. Waiting for a verified publication; previous evidence has not been replaced.'; return; }
    }
    if (!active) {
      await render('pages/overview.html', context); remember(context);
      status.textContent = context.head.epoch_id === head?.epoch_id ? 'Verified learning views. Evidence is checked when opened.' : 'Latest publication incomplete; showing the last verified learning epoch.';
    } else if (context.head.epoch_id === head?.epoch_id) {
      remember(context);
      if (active.head.epoch_id !== context.head.epoch_id) offer(context);
      else if (offered) { offered = null; status.textContent = 'Verified learning views. Evidence is checked when opened.'; }
    }
  }
  try { await refresh(true); }
  catch (_) { status.textContent = 'No complete verified epoch is available. Previous evidence has not been replaced.'; }
  let timer, stopped = false;
  function schedule() {
    if (!stopped) timer = window.setTimeout?.(async () => {
      try { if (!document.hidden) await refresh(); }
      catch (_) { /* Failed publication checks never replace the displayed epoch. */ }
      schedule();
    }, 60000);
  }
  schedule();
  window.addEventListener('pagehide', () => { stopped = true; window.clearTimeout?.(timer); }, {once: true});
})();
