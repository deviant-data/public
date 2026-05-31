(() => {
  "use strict";

  function assertState(state) {
    const source = objectValue(state);
    if (source.kind !== "streamlearn-viewer-state") {
      throw new Error("Static Viewer v5 expects streamlearn-viewer-state.");
    }
    if (!Array.isArray(source.views)) throw new Error("State views are required.");
    source.views.forEach((view, index) => assertView(view, index));
    return source;
  }

  function assertView(view, index) {
    const source = objectValue(view);
    if (!stringValue(source.kind, "")) throw new Error(`View ${index} is missing kind.`);
    if (!objectValue(source.data)) throw new Error(`View ${source.kind} is missing data.`);
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function stringValue(value, fallback) {
    return typeof value === "string" ? value.trim() : fallback;
  }

  globalThis.StaticViewerSchema = { assertState };
})();
