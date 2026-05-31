(() => {
  "use strict";

  const root = mustElement("renderRoot");
  let activeState = null;
  let activeSignal = "";
  let refreshTimer = null;

  loadSurface()
    .then((surface) => {
      if (!surface) return;
      registerCache();
      activeSignal = surface.signal;
      activeState = normalizeState(surface.state);
      render(activeState);
      startAutoRefresh();
    })
    .catch((error) => {
      root.replaceChildren(emptyShell(error.message));
    });

  window.addEventListener("hashchange", () => {
    if (activeState) render(activeState);
  });

  function mustElement(id) {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing element: ${id}`);
    return found;
  }

  async function loadSurface() {
    const query = new URLSearchParams(location.search);
    const stateRequested = query.get("fallback") === "1" || query.get("state") === "1";
    const [manifest, state] = await Promise.all([fetchJson("pages/manifest.json"), loadState()]);
    if (!stateRequested && shouldUseGeneratedPages(manifest)) {
      location.replace(`pages/${firstPage(manifest)}`);
      return null;
    }
    if (!state) throw new Error("Waiting for state/latest.json");
    return { state, signal: surfaceSignal(manifest, state) };
  }

  async function loadState() {
    return await fetchJson("state/latest.json") || await fetchJson("latest.json");
  }

  function shouldUseGeneratedPages(manifest) {
    return hasGeneratedPages(manifest) && !manifestWantsState(manifest);
  }

  function hasGeneratedPages(manifest) {
    return !!(manifest && Array.isArray(manifest.pages) && manifest.pages.length && firstPage(manifest));
  }

  function firstPage(manifest) {
    const first = manifest && (manifest.defaultPage || (manifest.pages[0] && manifest.pages[0].file));
    return String(first || "");
  }

  function manifestWantsState(manifest) {
    if (!manifest || typeof manifest !== "object") return false;
    const mode = String(manifest.viewerMode || manifest.mode || manifest.renderMode || "").toLowerCase();
    return manifest.stateOnly === true
      || manifest.preferState === true
      || manifest.latestJsonOnly === true
      || mode === "state"
      || mode === "latest"
      || mode === "json";
  }

  function surfaceSignal(manifest, state) {
    return [manifestSignal(manifest), stateSignal(state)].filter(Boolean).join("|");
  }

  function manifestSignal(manifest) {
    if (!manifest || typeof manifest !== "object") return "";
    return String(manifest.build_id || manifest.buildId || manifest.batchId
      || manifest.stateId || manifest.latestId || manifest.generatedAt || manifest.sha256 || "");
  }

  function stateSignal(state) {
    if (!state || typeof state !== "object") return "";
    return String(state.batchId || state.sha256 || state.generatedAt || "");
  }

  async function fetchJson(path) {
    try {
      const response = await fetch(cacheBusted(path), { cache: "no-store" });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  function cacheBusted(path) {
    const url = new URL(path, location.href);
    url.searchParams.set("_ts", String(Date.now()));
    return url.href;
  }

  function startAutoRefresh() {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (new URLSearchParams(location.search).get("replay") === "1") return;
    scheduleRefresh(5000);
    document.addEventListener("visibilitychange", scheduleRefresh);
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    const ms = typeof delay === "number" ? delay : (document.hidden ? 300000 : 60000);
    refreshTimer = setTimeout(checkForUpdate, ms);
  }

  async function checkForUpdate() {
    try {
      const [manifest, state] = await Promise.all([fetchJson("pages/manifest.json"), loadState()]);
      const nextSignal = surfaceSignal(manifest, state);
      if (nextSignal && nextSignal !== activeSignal) {
        if (shouldUseGeneratedPages(manifest)) {
          location.reload();
          return;
        }
        if (state) {
          activeSignal = nextSignal;
          activeState = normalizeState(state);
          render(activeState);
        }
      }
    } catch {
      // Keep the current static view if the network is temporarily unavailable.
    }
    scheduleRefresh();
  }

  function normalizeState(state) {
    if (globalThis.StaticViewerSchema) StaticViewerSchema.assertState(state);
    const views = (state.views || []).map((view, index) => ({
      kind: cleanId(view.kind || `view-${index}`),
      title: titleFor(view.kind || `view-${index}`),
      runId: Number(view.runId || 0),
      ts: String(view.ts || ""),
      codec: String(view.codec || ""),
      meta: objectValue(view.meta),
      data: objectValue(view.data),
      sha256: String(view.sha256 || "")
    }));
    return {
      version: Number(state.version || 1),
      kind: String(state.kind || "streamlearn-viewer-state"),
      batchId: String(state.batchId || ""),
      generatedAt: String(state.generatedAt || ""),
      sha256: String(state.sha256 || ""),
      summary: objectValue(state.summary),
      views
    };
  }

  function render(state) {
    root.replaceChildren(shell(state));
    window.scrollTo(0, 0);
  }

  function shell(state) {
    const wrap = el("div", "viewer");
    const header = el("header", "viewer-header");
    const brand = el("a", "brand", "streamlearn");
    brand.href = "#";
    brand.addEventListener("click", (event) => {
      event.preventDefault();
      history.replaceState(null, "", location.pathname + location.search);
      render(state);
    });
    header.append(brand, nav(state));

    const main = el("main", "viewer-main");
    const selected = currentView(state);
    main.append(statusStrip(state), selected ? viewSection(selected) : emptyShell("No views in state"));
    wrap.append(header, main);
    return wrap;
  }

  function nav(state) {
    const navEl = el("nav", "viewer-nav");
    state.views.forEach((view) => {
      const link = el("a", "", view.title);
      link.href = `#${encodeURIComponent(view.kind)}`;
      if (currentKind(state) === view.kind) link.setAttribute("aria-current", "page");
      navEl.append(link);
    });
    return navEl;
  }

  function statusStrip(state) {
    const strip = el("div", "status-strip");
    strip.append(
      chip("generated", formatDate(state.generatedAt)),
      chip("views", String(state.views.length)),
      chip("batch", shortText(state.batchId || state.sha256, 18))
    );
    return strip;
  }

  function viewSection(view) {
    const section = el("section", "view-section");
    const top = el("div", "view-top");
    top.append(el("h1", "", view.title), viewMeta(view));
    section.append(top, renderKnownView(view));
    return section;
  }

  function viewMeta(view) {
    const meta = el("div", "view-meta");
    if (view.runId) meta.append(chip("run", String(view.runId)));
    if (view.ts) meta.append(chip("time", formatDate(view.ts)));
    if (view.codec) meta.append(chip("codec", view.codec));
    if (view.sha256) meta.append(chip("hash", shortText(view.sha256, 12)));
    return meta;
  }

  function renderKnownView(view) {
    const data = view.data;
    if (view.kind === "overview") return overviewView(data);
    if (view.kind === "clusters") return listView(data, "clusters", ["id", "label", "size", "sample"]);
    if (view.kind === "triples") return listView(data, "triples", ["subject", "predicate", "object", "count", "confidence"]);
    if (view.kind === "rules") return listView(data, "rules", ["rule", "antecedent", "consequent", "support", "confidence", "belief"]);
    if (view.kind === "sources") return listView(data, "sources", ["name", "items", "share", "last_seen", "status"]);
    if (view.kind === "topics") return topicsView(data);
    if (view.kind === "graph") return graphView(data);
    if (view.kind === "scatter") return listView(data, "pts", ["label", "cluster", "x", "y", "z"]);
    if (view.kind === "heatmap") return heatmapView(data);
    if (view.kind === "ipfs") return listView(data, "cells", ["cid", "archive_id", "verified", "pinned", "bytes"]);
    if (view.kind === "history") return listView(data, "frames", ["kind", "run_id", "ts", "bytes"]);
    return genericObject(data);
  }

  function overviewView(data) {
    const grid = el("div", "dashboard-grid");
    grid.append(
      card("counts", keyValues({ ...objectValue(data.counts), pending: data.pending || 0 })),
      card("top drifters", dataTable(arrayValue(data.drifters), ["cluster", "drift", "size"])),
      card("central entities", dataTable(arrayValue(data.entities), ["entity", "score", "component"])),
      card("last runs", dataTable(arrayValue(data.runs), ["stage", "started_at", "exit_code"]))
    );
    return grid;
  }

  function topicsView(data) {
    const grid = el("div", "dashboard-grid");
    grid.append(
      card("topic rows", dataTable(arrayValue(data.topic_rows), ["cluster", "label", "size", "drift"])),
      card("entities", dataTable(arrayValue(data.entities), ["entity", "score", "component"])),
      card("series", dataTable(arrayValue(data.series), ["label", "points"]))
    );
    return grid;
  }

  function graphView(data) {
    const grid = el("div", "dashboard-grid two");
    grid.append(
      card("nodes", dataTable(arrayValue(data.nodes), ["id", "label", "score", "component"])),
      card("edges", dataTable(arrayValue(data.edges), ["source", "target", "weight"]))
    );
    return grid;
  }

  function heatmapView(data) {
    const grid = el("div", "dashboard-grid");
    grid.append(
      card("labels", tagList(arrayValue(data.labels))),
      card("buckets", keyValues({ count: data.bucket_count || arrayValue(data.buckets).length })),
      card("matrix", dataTable(arrayValue(data.rows || data.matrix), ["label", "values"]))
    );
    return grid;
  }

  function listView(data, key, preferred) {
    const rows = arrayValue(data[key]);
    const grid = el("div", "dashboard-grid");
    grid.append(card(titleFor(key), dataTable(rows, preferred)));
    const rest = Object.entries(data).filter(([name]) => name !== key);
    rest.slice(0, 6).forEach(([name, value]) => {
      grid.append(card(titleFor(name), renderValue(value, 0)));
    });
    return grid;
  }

  function genericObject(value) {
    const grid = el("div", "dashboard-grid");
    Object.entries(objectValue(value)).forEach(([key, item]) => {
      grid.append(card(titleFor(key), renderValue(item, 0)));
    });
    if (!grid.children.length) grid.append(card("data", el("p", "muted", "empty")));
    return grid;
  }

  function renderValue(value, depth) {
    if (Array.isArray(value)) {
      if (!value.length) return el("p", "muted", "empty");
      if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return dataTable(value);
      return tagList(value.slice(0, 80));
    }
    if (value && typeof value === "object") {
      if (depth > 1) return el("code", "", JSON.stringify(value));
      return keyValues(value, depth + 1);
    }
    return el("span", "value", formatValue(value));
  }

  function card(title, body) {
    const box = el("article", "card");
    box.append(el("h2", "", title), body);
    return box;
  }

  function keyValues(obj, depth = 0) {
    const dl = el("dl", "kv");
    Object.entries(objectValue(obj)).slice(0, 80).forEach(([key, value]) => {
      dl.append(el("dt", "", titleFor(key)), el("dd", "", ""));
      dl.lastChild.append(renderValue(value, depth));
    });
    if (!dl.children.length) return el("p", "muted", "empty");
    return dl;
  }

  function dataTable(rows, preferred = []) {
    const data = arrayValue(rows).slice(0, 1000);
    if (!data.length) return el("p", "muted", "empty");
    const keys = columnsFor(data, preferred);
    const table = el("table", "");
    const head = document.createElement("tr");
    keys.forEach((key) => head.append(el("th", "", titleFor(key))));
    table.append(head);
    data.forEach((row) => {
      const tr = document.createElement("tr");
      keys.forEach((key) => tr.append(el("td", "", formatCell(rowValue(row, key)))));
      table.append(tr);
    });
    return table;
  }

  function columnsFor(rows, preferred) {
    const found = new Set();
    rows.forEach((row) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        Object.keys(row).forEach((key) => found.add(key));
      }
    });
    const preferredFound = preferred.filter((key) => found.has(key));
    const rest = Array.from(found).filter((key) => !preferredFound.includes(key)).slice(0, 8 - preferredFound.length);
    return (preferredFound.length ? preferredFound.concat(rest) : rest).slice(0, 8);
  }

  function rowValue(row, key) {
    return row && typeof row === "object" ? row[key] : "";
  }

  function tagList(values) {
    const wrap = el("div", "tags");
    values.forEach((value) => wrap.append(el("span", "tag", formatValue(value))));
    if (!wrap.children.length) return el("p", "muted", "empty");
    return wrap;
  }

  function chip(label, value) {
    const item = el("span", "chip");
    item.append(el("span", "chip-label", label), document.createTextNode(value || "none"));
    return item;
  }

  function currentView(state) {
    const kind = currentKind(state);
    return state.views.find((view) => view.kind === kind) || state.views[0] || null;
  }

  function currentKind(state) {
    const raw = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    return state.views.some((view) => view.kind === raw) ? raw : ((state.views[0] && state.views[0].kind) || "");
  }

  function emptyShell(message) {
    const wrap = el("div", "empty-shell");
    wrap.append(el("h1", "", "Static Viewer"), el("p", "", message));
    return wrap;
  }

  function registerCache() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function arrayValue(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanId(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "view";
  }

  function titleFor(value) {
    return String(value || "").replace(/[_-]+/g, " ").trim() || "view";
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().replace(".000Z", "Z");
  }

  function formatCell(value) {
    if (Array.isArray(value)) return `${value.length} items`;
    if (value && typeof value === "object") return JSON.stringify(value).slice(0, 160);
    return formatValue(value);
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  }

  function shortText(value, max) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max)}` : text;
  }
})();
