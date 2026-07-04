// Cinematic camera-move tuning constants — SINGLE retune point for the app.
// The Stream Deck plugin is a separate build target (rootDir: src) and cannot
// import this file; its mirror lives at streamdeck-plugin/src/moveDefaults.ts.
// Change a number here → change it there too.

/** Default preset-to-preset sweep duration (ms) when the caller doesn't say. */
export const SWEEP_DEFAULT_MS = 6000

/** Slow optical zoom push/pull: default guard window (ms). */
export const SLOW_ZOOM_DEFAULT_MS = 10000
/** Slow push-IN target = current zoom × this factor. */
export const SLOW_ZOOM_IN_FACTOR = 1.5
/** Slow pull-OUT target = current zoom × this factor. */
export const SLOW_ZOOM_OUT_FACTOR = 0.67

/** Tablet PTZ popup nudge: gimbal velocity for a held direction pad. */
export const TABLET_NUDGE_SPEED = 40
