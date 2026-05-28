# Static Viewer v4 Notes

Date: 2026-05-27

## Goal

Render public Streamlearn state without exposing the private service.

## Boundary

Static Viewer v4 accepts static pages generated from Streamlearn, with `streamlearn-viewer-state` as a fallback.

## Delivery

The public deployment contains this renderer plus generated static files:

```text
pages/*.html
static/sl.js
state/latest.json
```

The renderer loads generated pages first. If no generated pages are present, it falls back to `state/latest.json`.

## Producer

The server-side publisher produces the public state from Streamlearn replay frames and static pages from the local dashboard service.

## Dependencies

Required runtime dependencies: none.
