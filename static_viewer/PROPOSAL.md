# Static Viewer v4 Proposal

Static Viewer v4 is only the public renderer for `streamlearn_viewer` state.

## Architecture

```text
streamlearn_7
  -> streamlearn_viewer
  -> pages/*.html
  -> state/latest.json
  -> static_viewer_v4
```

## Rules

- No endpoint selection.
- No GitHub Action reaching into Streamlearn.
- Prefer generated static pages.
- Keep `state/latest.json` as a fallback and machine-readable state.

## State

Primary input:

```text
state/latest.json
```

Accepted shape:

```json
{
  "kind": "streamlearn-viewer-state",
  "views": [
    {
      "kind": "overview",
      "runId": 1,
      "ts": "2026-05-27T00:00:00Z",
      "data": {}
    }
  ]
}
```

## Rendering

The page loads generated static dashboard pages when they are available. Those pages preserve the private dashboard layout without exposing the private service URL. If pages are absent, the fallback renderer reads the `views` array directly.
