// Cinematic camera-move tuning constants — deck-plugin mirror of the app's
// src/shared/cameraMoves.ts (separate build target, can't share the module).
// Change a number here → change it there too.

/** Default preset-to-preset sweep duration (ms). */
export const SWEEP_DEFAULT_MS = 6000

/** Slow optical zoom push: default guard window (ms) and push-in factor. */
export const SLOW_ZOOM_DEFAULT_MS = 10000
export const SLOW_ZOOM_IN_FACTOR = 1.5
