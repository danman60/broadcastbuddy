/**
 * Lossless apply of a web/BB-authored OverlayStyling-shaped config onto the live
 * overlay styling. Shared by:
 *   - CC_APPLY_PACKAGE (ipc.ts) — applies pkg.overlayConfig when a package is
 *     pulled/relayed.
 *   - ccRelay 'overlay-config' broadcast — live editor sync from CommandCentered.
 *
 * Copies every OverlayStyling key with `!== undefined` so 0 / false / '' values
 * (letterSpacing 0, subtitleFontSize 0, textShadow false) apply, not just truthy
 * ones. Includes `layout` (so editor-positioned elements move in OBS) and
 * `elements` (CompSync-style per-element deep styling) — the editor's full save
 * payload is `{ ...styling, layout, elements }`, so all of it must pass through.
 */
import type { OverlayStyling } from '../../shared/types'

// The exhaustive set of OverlayStyling keys we copy from an inbound config.
const OVERLAY_STYLING_KEYS: (keyof OverlayStyling)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'backgroundColor',
  'backgroundStyle', 'accentColor', 'borderRadius', 'animation',
  'animationDuration', 'animationEasing', 'autoHideSeconds', 'layout',
  'titleTextTransform', 'titleLetterSpacing', 'subtitleFontSize',
  'subtitleColor', 'textShadow', 'textGlow', 'labelColor', 'labelBackgroundColor',
  'elements',
]

export function applyOverlayConfigToStyling(
  oc: Record<string, unknown>,
): Partial<OverlayStyling> {
  const updates: Partial<OverlayStyling> = {}
  if (!oc || typeof oc !== 'object') return updates
  const copy = <K extends keyof OverlayStyling>(k: K) => {
    if (oc[k as string] !== undefined) updates[k] = oc[k as string] as OverlayStyling[K]
  }
  OVERLAY_STYLING_KEYS.forEach((k) => copy(k))
  return updates
}
