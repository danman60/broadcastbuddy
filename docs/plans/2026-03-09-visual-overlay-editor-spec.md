# Visual Overlay Editor Spec — 2026-03-09

## Overview

Single-click on the OverlayPreview canvas opens a full-screen drag-and-drop overlay editor. Users can position, resize, and style overlay elements visually, and changes reflect in the actual OBS browser source in real-time.

## Entry Point

- **Single click** on the preview canvas in the left panel opens the editor
- Editor renders as a full-screen modal overlay (z-index above everything)
- Press Escape or click "Close" to return to normal view

## Editor Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Close]                    Visual Editor                [Save] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────── 16:9 Canvas ────────────────────────┐   │
│  │                                                          │   │
│  │   [Company Logo]                        [Client Logo]    │   │
│  │                                                          │   │
│  │                                                          │   │
│  │                                                          │   │
│  │   ┌─────────────────────────┐                            │   │
│  │   │  Lower Third Card       │  ← draggable, resizable   │   │
│  │   │  Title / Subtitle       │                            │   │
│  │   └─────────────────────────┘                            │   │
│  │                                                          │   │
│  │   [Starting Soon]  ← can position the full scene        │   │
│  │   [Ticker Bar]     ← drag vertical position             │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Element Properties Panel (right sidebar when element selected) │
│  ├─ Position: x, y (px or %)                                   │
│  ├─ Size: width, height                                         │
│  ├─ Margin/Padding                                              │
│  └─ Element-specific: font size, colors, opacity, etc.          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Draggable Elements

| Element | Draggable | Resizable | Properties |
|---------|-----------|-----------|------------|
| Lower Third Card | Yes (x, y) | Width only | position, maxWidth |
| Company Logo | Yes (x, y) | Yes (scale) | position, maxHeight, maxWidth |
| Client Logo | Yes (x, y) | Yes (scale) | position, maxHeight, maxWidth |
| Ticker Bar | Vertical only | Height only | y position, height |
| Starting Soon | No (full screen) | No | colors, font sizes |

## Data Model

```typescript
interface ElementPosition {
  // All values in percentages (0-100) relative to 1920x1080 canvas
  x: number      // left position %
  y: number      // top position %
  width?: number  // width % (optional, auto if not set)
  height?: number // height % (optional)
}

// Add to OverlayState or OverlayStyling:
interface OverlayLayout {
  lowerThird: ElementPosition    // default: { x: 3.1, y: 84 }
  companyLogo: ElementPosition   // default: { x: 2, y: 2.8 }
  clientLogo: ElementPosition    // default: { x: 89.6, y: 2.8 }
  ticker: ElementPosition        // default: { x: 0, y: 96.3, width: 100 }
}
```

## Interaction Design

1. **Click to select** — Shows bounding box with 8 resize handles
2. **Drag to move** — Snaps to grid (optional, toggle with Ctrl)
3. **Resize handles** — Corner/edge handles, maintains aspect ratio with Shift
4. **Smart guides** — Shows alignment lines when elements align with each other or canvas edges
5. **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z for position changes
6. **Snap to safe zone** — Broadcasting safe zone guides (10% margin)

## Implementation Approach

### Phase 1: Basic drag-and-drop
- Full-screen modal with scaled 16:9 canvas
- Drag lower third, logos, ticker
- Store positions in OverlayStyling (new `layout` field)
- Apply positions in both preview CSS and browser source HTML

### Phase 2: Resize and properties panel
- Resize handles on selected element
- Properties panel sidebar showing x, y, width, height
- Numeric input for precise positioning
- Apply to browser source CSS in real-time via WebSocket

### Phase 3: Polish
- Smart alignment guides
- Snap-to-grid toggle
- Broadcasting safe zone overlay
- Undo/redo stack
- Keyboard nudge (arrow keys move selected element 1px, Shift+arrow = 10px)

## Technical Notes

- Canvas renders at a fixed aspect ratio (16:9) and scales to fit the modal
- Mouse coordinates must be transformed from screen space to canvas space
- Position values stored as percentages for resolution independence
- Browser source HTML (`buildOverlayHTML`) reads layout values and sets CSS `left`, `top`, etc.
- Preview component reads the same layout values for consistent rendering
- Changes broadcast via WebSocket immediately (live preview in OBS)

## Files to Modify

- `src/shared/types.ts` — Add `OverlayLayout` interface, add to `OverlayStyling`
- `src/renderer/components/VisualEditor.tsx` — New full-screen editor component
- `src/renderer/components/OverlayPreview.tsx` — Add click handler to open editor
- `src/renderer/styles/visualEditor.css` — New styles
- `src/main/services/overlay.ts` — Apply layout in `buildOverlayHTML`
- `src/renderer/components/App.tsx` — Render editor modal when open
