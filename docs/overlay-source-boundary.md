# Overlay browser-source boundary

The HTML extraction requested by streamline item 5 already exists in base commit `b0e3004`:

- `src/main/services/overlaySource.ts` owns `buildOverlayHTML(state, wsPort)` and browser-side rendering.
- `src/main/services/overlay.ts` owns mutable overlay state, timers, navigation and the HTTP server.
- The `/overlay` handler passes the current state and configured WebSocket port to the builder.

`overlaySource.ts` is retained byte for byte. The graph and source search identify the `/overlay` handler as its only application caller. No setting or user-visible behavior is added.

Runtime coverage is in `tests/overlay-statemachine.spec.ts`, `tests/browser-source-styling.spec.ts`, `tests/browser-source-behaviors.spec.ts` and `tests/http-endpoints.spec.ts`. The streamlines report records the measured before/after results and the locally held fired-overlay screenshots.
