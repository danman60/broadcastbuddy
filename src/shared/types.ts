// ── Playlist Types ──────────────────────────────────────────────

export type LoopMode = 'none' | 'loop' | 'ping-pong'
export type ImportMode = 'replace' | 'append'

// ── Trigger (a single overlay entry) ──────────────────────────────

export interface Trigger {
  id: string
  name: string // display label in the trigger list
  title: string // primary line on the lower third (e.g. song name, speaker name)
  subtitle: string // secondary line on the lower third (e.g. dancers, company/role)
  category: string // grouping label (optional)
  order: number // sort position
  logoDataUrl: string // per-entry logo (base64 data URL, optional)
  type?: 'lower_third' | 'title_card' | 'feature' // visual form (default lower_third); title_card/feature → full-screen feature card
  dancerCount?: number // optional — # of dancers in the routine; drives OBSBOT camera framing on fire (no-op unless a camera host is configured)
  cameraMove?: TriggerCameraMove // optional — choreographed PTZ move fired WITH this trigger (no-op unless a camera host is configured)
}

/**
 * Choreographed camera move attached to a trigger — fires automatically when the
 * trigger fires, so a routine can carry its own cinematic move (e.g. the finale's
 * audience sweep) while the operator runs lower thirds.
 *  - kind 'sweep': preset from → to over ms, optionally via waypoint presets.
 *  - kind 'replay': replay recorded move `moveId` (shot recorder).
 */
export interface TriggerCameraMove {
  kind: 'sweep' | 'replay'
  from?: number // sweep: start preset id
  to?: number // sweep: end preset id
  ms?: number // sweep: total duration (default SWEEP_DEFAULT_MS)
  waypoints?: number[] // sweep: intermediate preset ids for a paced glide
  moveId?: number // replay: recorded move id
}

// ── Overlay Styling ──────────────────────────────────────────────

export type BackgroundStyle = 'solid' | 'gradient' | 'glass' | 'accent-bar'
export type AnimationType = 'slide' | 'fade' | 'zoom' | 'rise' | 'typewriter' | 'bounce' | 'split' | 'blur' | 'sparkle' | 'random'
export type EasingType = 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear' | 'bounce' | 'elastic'

export interface ElementPosition {
  x: number // % from left (0-100)
  y: number // % from top (0-100)
  width?: number // % width
  height?: number // % height
}

export interface OverlayLayout {
  lowerThird: ElementPosition
  companyLogo: ElementPosition
  clientLogo: ElementPosition
  ticker: ElementPosition
  clock: ElementPosition
  counter: ElementPosition
}

export const DEFAULT_LAYOUT: OverlayLayout = {
  lowerThird: { x: 3.1, y: 85 },
  companyLogo: { x: 2.1, y: 2.8 },
  clientLogo: { x: 87.9, y: 2.8 },
  ticker: { x: 0, y: 96.3, width: 100 },
  clock: { x: 2.1, y: 89 },
  counter: { x: 86, y: 4, width: 13 },
}

export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize'

export interface OverlayStyling {
  fontFamily: string
  fontSize: number // px
  fontWeight: number // 100..900
  textColor: string // hex
  backgroundColor: string // hex
  backgroundStyle: BackgroundStyle
  accentColor: string // hex
  borderRadius: number // px
  animation: AnimationType
  animationDuration: number // seconds
  animationEasing: EasingType
  autoHideSeconds: number // 0 = manual hide only
  layout?: OverlayLayout

  // ── Richer title/subtitle styling (ported from CompSync StartingSoonEditor) ──
  titleTextTransform?: TextTransform   // applied to the title line
  titleLetterSpacing?: number          // px (can be negative)
  subtitleFontSize?: number            // px — own size, overrides the 0.7x ratio when set
  subtitleColor?: string               // hex — own color, overrides textColor when set
  textShadow?: boolean                 // drop shadow on title + subtitle for legibility
  textGlow?: boolean                   // soft accent-colored glow behind the card text
  // Lower-third label prefix style (UP NEXT / THAT WAS chip)
  labelColor?: string                  // hex — label text color
  labelBackgroundColor?: string        // hex — label chip background

  // ── CompSync-style PER-ELEMENT deep styling (optional, non-breaking) ──
  // When absent, the renderer falls back to the global styling above. When a
  // sub-entry is present, it overrides that element/sub-element only.
  elements?: OverlayPerElementStyling
}

/**
 * Per-sub-element styling (CompSync OverlaySubElementStyle). Overrides the
 * element's CSS defaults via inline style. All fields optional.
 */
export interface OverlaySubElementStyle {
  fontSize?: number    // px; absent/0 = use CSS default
  color?: string       // hex; absent/'' = use CSS default
  fontWeight?: number  // 100..900; absent/0 = use CSS default
  order?: number       // flex order within the card; default 0
  show?: boolean       // false hides this sub-element (display:none)
}

/**
 * Element-level card / container styling (CompSync OverlayElementCardStyle).
 * Applied as inline overrides on the element root. All fields optional.
 */
export interface OverlayElementCardStyle {
  backgroundColor?: string   // hex; absent/'' = use existing default
  backgroundOpacity?: number // 0..1 (combined with backgroundColor → rgba)
  backdropBlur?: number      // px; absent/0 = none
  paddingX?: number          // px
  paddingY?: number          // px
  innerGap?: number          // px; gap between sub-elements
  borderRadius?: number      // px
  borderColor?: string       // hex
  borderWidth?: number       // px
}

/**
 * Optional per-element styling layer that sits on top of the global
 * OverlayStyling. Absent entries fall back to the global look.
 */
export interface OverlayPerElementStyling {
  lowerThird?: {
    card?: OverlayElementCardStyle
    sub?: Partial<Record<'title' | 'subtitle' | 'label', OverlaySubElementStyle>>
  }
  featureCard?: {
    sub?: Partial<Record<'kicker' | 'title' | 'subtitle', OverlaySubElementStyle>>
  }
}

// ── User Style Preset (operator-saved, persisted via electron-store) ─────────
// Structural twin of presets.ts `StylePreset`. Lives here (not presets.ts) so
// AppSettings can reference it without a renderer↔settings circular import.
// `source: 'user'` distinguishes these from the static built-in PRESETS so the
// gallery only allows deleting user ones.
export interface UserStylePreset {
  id: string
  name: string
  description: string
  styling: OverlayStyling
  source: 'user'
  createdAt: string // ISO
}

// ── Stream Config ────────────────────────────────────────────────

export interface StreamConfig {
  streamKey: string
  rtmpUrl: string
  viewingLink: string
  embedCode: string
  chatLink: string
}

// ── Notes ────────────────────────────────────────────────────────

export interface Note {
  id: string
  text: string
  timestamp: string // wall clock ISO
  obsTimecode: string // HH:MM:SS from OBS recording, or empty
  createdAt: string
}

// ── Starting Soon ────────────────────────────────────────────────

// Pre-show ambient media stack layered on top of the simple countdown scene.
// Genericized from CompSync's competition pre-show (folder-served media) to a
// data-URL pushed-state model so it follows BB's stateless browser-source
// pattern. All elements default OFF / empty — the simple countdown is unaffected
// unless the operator turns a sub-element on.
export interface StartingSoonMedia {
  sponsorLogos: string[]      // base64 data URLs, rotated on a timer
  sponsorIntervalSec: number  // rotation period (seconds)
  slideshowPhotos: string[]   // base64 data URLs, cross-faded on a timer
  slideshowIntervalSec: number
  socialBar: string           // operator text strip, e.g. "@studio • #recital2026 • site.com"
  welcomeLine: string         // e.g. "Welcome to the Spring Recital" — shown above the countdown
  venueName: string           // e.g. "Roy Thomson Hall" — shown with the welcome line
  showSponsors: boolean
  showSlideshow: boolean
  showSocialBar: boolean
  showWelcome: boolean
  // ── Live media layer (ported from CompSync Starting-Soon) ──
  videoUrl?: string        // optional live/loop video feed URL for the inset window
  showVideo?: boolean      // toggle the framed inset <video> window
  showVisualizer?: boolean // toggle the bottom audio/decorative bar visualizer
}

// ── Starting-Soon Scene Editor (ported from CompSync StartingSoonEditor) ──
// The simple StartingSoonPanel stays the form-based config. This optional layer
// gives the operator a drag-positioned, designed scene. ALL fields optional —
// when `layout`/`design` are absent the overlay renders the original centered
// flex column unchanged (non-breaking).

// Elements BB's starting-soon overlay actually renders and can position/style.
// (No logo/eventCard/upNext/pinnedChat/timeDate/ticker — those are NOT part of
// BB's SS scene today; see DEFERRED note in the editor. Adding a control for an
// element the overlay can't render would be a dead control.)
export type SSElementKey =
  | 'title'
  | 'subtitle'
  | 'countdown'
  | 'welcome'
  | 'sponsors'
  | 'social'
  | 'slideshow'
  | 'visualizer'

// Per-element placement + visibility override. When present for an element the
// renderer switches it from the centered flex flow to absolute positioning at
// (x%, y%) and honours `show`. Absent → element keeps its default flex position.
export interface SSElementPlacement {
  x: number // % from left (0-100), anchor = element center
  y: number // % from top (0-100)
  show?: boolean // false hides the element entirely (default: shown)
  fontSize?: number // px override (title/subtitle/countdown/welcome/social)
  color?: string // hex override
  fontWeight?: number // 100..900 override
}

export type SSElementLayout = Partial<Record<SSElementKey, SSElementPlacement>>

// One-tap designed identity (gradient + typography + countdown weight + colors).
export interface SSDesign {
  presetId?: string // id of the applied gradient/pro-pack (informational)
  gradientColors?: string[] // 2-4 hex stops; absent = use accentColor-derived gradient
  gradientAngle?: number // deg (default 135)
  titleFont?: string // CSS font-family for the title line
  subtitleFont?: string // CSS font-family for the subtitle/welcome/social
  countdownWeight?: number // 100..900 for the countdown digits
}

export interface StartingSoonState {
  visible: boolean
  title: string
  subtitle: string
  countdownTarget: string // ISO date or empty
  countdownSeconds: number // exact seconds for countdown (alternative to target)
  showCountdown: boolean
  completionText: string // shown when countdown reaches 0
  backgroundColor: string
  textColor: string
  accentColor: string
  sectionLabel?: string // optional cinematic section badge text (e.g. "ACT TWO"); empty/absent = no badge
  media?: StartingSoonMedia // optional pre-show ambient media stack (all off by default)
  // Full-frame "cover" backdrop slot (distinct from media.videoUrl, which is an
  // inset framed window). When backdropMode==='cover' && backdropVideoUrl is set,
  // a looping opaque MP4 fills the frame behind the countdown/text. Absent/empty
  // or backdropMode==='none' → renders exactly as before. The browser source
  // unloads the video element on hide (zero decode cost when inactive).
  backdropVideoUrl?: string // full-frame looping MP4 URL (http(s) or BB-served). Empty/absent = no video backdrop.
  backdropMode?: 'cover' | 'none' // 'cover' = full-frame object-fit:cover opaque backdrop. Default 'none'.
  layout?: SSElementLayout // optional per-element drag placement/style (scene editor)
  design?: SSDesign // optional one-tap design (gradient/fonts/weights)
}

// ── On-air Clock ─────────────────────────────────────────────────
// Broadcast-chrome wall clock. Browser source reads local time on a 1s
// interval; format/showSeconds drive the rendered string.

export interface ClockState {
  visible: boolean
  format: '12h' | '24h'
  showSeconds: boolean
}

// ── Counter ──────────────────────────────────────────────────────
// Generic numeric badge ("#42" style) with an operator-set label
// (e.g. "ENTRY" / "SONG" / ""). Pop-in animation fires on value change.

export interface CounterState {
  visible: boolean
  value: number
  label: string
}

// ── Feature Card ─────────────────────────────────────────────────
// Full-screen cinematic graphic for UP NEXT / THAT WAS / a featured
// performer. Separate from the wave-4 lower-third chip — richer treatment
// the operator can choose instead. firedAt drives the entrance re-trigger
// in the browser source.

export type FeatureCardAnim = 'slide-up' | 'slide-left' | 'fade' | 'zoom'

export interface FeatureCardState {
  visible: boolean
  kicker: string // "UP NEXT" / "THAT WAS" / custom
  title: string
  subtitle: string
  logoDataUrl: string // base64 data URL or empty
  animateIn: FeatureCardAnim
  firedAt: number // epoch ms — bump to re-trigger the entrance animation
  nextLabel?: string // optional UP-NEXT preview strip label (e.g. "THEN"); empty/absent = no strip
  nextTitle?: string // optional UP-NEXT preview strip title (e.g. "Awards Ceremony")
}

// ── Overlay State (pushed to browser source) ─────────────────────

export interface OverlayState {
  lowerThird: {
    visible: boolean
    name: string
    title: string
    subtitle: string
    label: string // optional prefix chip text (e.g. "UP NEXT" / "THAT WAS"), empty = no chip
    styling: OverlayStyling
  }
  companyLogo: {
    visible: boolean
    dataUrl: string // base64 data URL or empty
  }
  clientLogo: {
    visible: boolean
    dataUrl: string
  }
  ticker: {
    visible: boolean
    text: string
    speed: number // pixels per second
    backgroundColor: string
    textColor: string
  }
  startingSoon: StartingSoonState
  clock: ClockState
  counter: CounterState
  featureCard: FeatureCardState
  // Pinned viewer-chat message rendered as an on-stream lower-left card. Driven
  // by CC's 'chat-message' broadcast (pinned:true shows, pinned:false hides) and
  // by the local operator toggle. Server-side auto-hide; CSS slide-in animation.
  chatMessage: { visible: boolean; author: string; text: string }
  gridVisible: boolean // operator leveling grid (rule-of-thirds) — off the live stream
}

// ── Session (saved/loaded as JSON) ───────────────────────────────

export interface Session {
  id: string
  name: string
  triggers: Trigger[]
  styling: OverlayStyling
  companyLogoDataUrl: string
  clientLogoDataUrl: string
  selectedIndex?: number
  playedIds?: string[]
  loopMode?: LoopMode
  streamConfig?: StreamConfig
  notes?: Note[]
  createdAt: string // ISO date
  updatedAt: string // ISO date
}

// ── Field Mapping Types ─────────────────────────────────────────

export interface LLMExtractedField {
  name: string
  value: string
  confidence?: number
}

export type TransformType = 'concat' | 'extract' | 'split' | 'format' | 'none'

export interface TransformConfig {
  type: TransformType
  params: Record<string, unknown>
}

export interface FieldMapping {
  sourceIds: string[]
  targetId: 'name' | 'title' | 'subtitle' | 'category' | 'logoDataUrl' | 'dancerCount'
  transform: TransformConfig
}

export interface MappingPreset {
  id: string
  name: string
  mappings: FieldMapping[]
  autoMapPatterns?: Record<string, string[]>
}

export interface ExtractionResult {
  rawFields: LLMExtractedField[]
  sampleData: Record<string, string>[]
  suggestedMappings?: FieldMapping[]
}

// ── App Settings (persisted via electron-store) ──────────────────

export interface AppSettings {
  server: {
    httpPort: number
    wsPort: number
  }
  overlay: OverlayStyling
  companyLogoPath: string
  featureCardLogoPath: string // persistent graphics/feature-card logo (data URL); empty = fall back to per-trigger logo
  userPresets?: UserStylePreset[] // operator-saved style presets (shown next to built-in PRESETS)
  deepseekApiKey: string
  geminiApiKey: string
  sessionsDir: string
  mappingPresets?: MappingPreset[]
  compactMode?: boolean
  leftPanelWidth?: number
  streamConfig?: StreamConfig
  obsConnection?: {
    host: string
    port: number
    password: string
  }
  ccConfig?: {
    baseUrl: string
    apiKey: string
    tenantId: string
  }
  r2Config?: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
  }
  wifiDisplay?: WifiDisplaySettings
  slowZoom?: SlowZoomSettings
  obsTransitionRevert?: boolean
  chatConfig?: ChatConfig
  // Persisted CC→BB live relay config (incl. viewer-chat feed chatChannel) so a
  // mid-show BB restart re-arms the relay + chat feed without re-applying the
  // package. Written on package-apply; read at IPC registration startup.
  ccRelayConfig?: CcRelayConfig
  dayChecklistLastShown?: string // YYYY-MM-DD the start-of-day modal last auto-shown
  hotkeys?: HotkeyConfig
  // OBSBOT camera host (IP). Empty/unset = camera integration OFF (complete
  // no-op on trigger fire). When set, firing a trigger with a numeric
  // dancerCount drives the camera's framing via @compsync/camera.
  cameraHost?: string
  // ── Second PTZ camera (multi-camera control). Camera 2 is off unless cameraHost2
  // is set (NO plug-and-play default). `activeCameraId` selects which camera the
  // manual / Xbox / Stream Deck controls drive (1 or 2; default 1). Camera 1 is the
  // program/auto camera (routine cadence). See cameraDirector resolveCameraHostFor.
  cameraHost2?: string // 2nd OBSBOT camera IP. Empty = camera 2 off.
  cameraPort2?: number // 2nd camera HTTP port. Default 80.
  activeCameraId?: 1 | 2 // which PTZ the manual/Xbox/deck controls target. Default 1.
  // ── OBSBOT camera — additive controls (all optional; defaults = current OFF
  // behaviour). The camera feature is considered ACTIVE when cameraAutoMode is
  // true OR cameraHost is non-empty (see resolveCameraHost / isCameraFeatureActive
  // in cameraDirector.ts). When active but cameraHost is blank, the OBSBOT
  // USB/RNDIS default 192.168.88.10 is used so the operator never types an IP.
  cameraAutoMode?: boolean // master opt-in: auto-frame on trigger fire. Default false.
  cameraFramingMode?: 'recital' | 'competition' // Director framing floor. Default 'recital'.
  cameraPort?: number // camera HTTP port. Default 80.
  // ── PTZ control panel tuning (all optional; defaults applied in the renderer
  // sender/gamepad: deadzone 0.12, expo 0.6, command rate 10Hz). Additive.
  cameraJoystickDeadzone?: number // gamepad scaled radial deadzone (0–1). Default 0.12.
  cameraExpo?: number // gamepad expo curve strength (0–1). Default 0.6.
  cameraStickMaxSpeed?: number // gamepad max gimbal velocity at full deflection (1–178). Default 30.
  cameraPresetThumbs?: Record<string, string> // preset thumbnails, key `${camera}:${slot}` → small JPEG data URL snapped from the UVC preview on save
  cameraCommandRateHz?: number // shared command-sender flush rate (Hz). Default 10.
  cameraPreviewDeviceId?: string // chosen videoinput deviceId for the live preview monitor.

  // ── Voice-driven PTZ director (push-to-talk, offline SAPI grammar). All optional;
  // dormant unless voiceEnabled AND a camera host is set. The bundled voice-helper.exe
  // (Windows System.Speech) does the recognition; BB builds the grammar from voiceShots.
  // See src/main/services/voiceDirector.ts + docs/superpowers/specs/2026-06-23-voice-ptz-director-design.md.
  voiceEnabled?: boolean // master opt-in for the voice director. Default false.
  voiceMicDeviceId?: string // capture device LABEL for the helper (empty = Windows default); name kept for stored settings
  voiceConfidenceFloor?: number // 0–1; matches below this are rejected. Default 0.6.
  voiceZoomSpeed?: number // OBSBOT zoom-velocity speed for "zoom in/out" nudges. Default 3.
  voiceZoomNudgeMs?: number // duration of a bounded "zoom in/out" nudge before auto-stop. Default 600.
  voiceSlowPushMs?: number // "slow push in" duration. Default 15000.
  voiceSlowPushFactor?: number // "slow push in" tele factor (current × this). Default 1.3.
  voiceShots?: VoiceShotMap // per-camera saved shots (slot id + optional spoken label).
  // Hands-free wake word: when voiceWakeEnabled, the helper listens CONTINUOUSLY and
  // every command must be prefixed by voiceWakeWord (e.g. "broadcast push in"), so the
  // deck PTT key is no longer required. PTT still works as an override. Default off.
  voiceWakeEnabled?: boolean // continuous hands-free recognition gated by the wake word.
  voiceWakeWord?: string // required spoken prefix in wake mode. Default "broadcast".

  // ── Shot recorder — saved manual moves (record joystick path → replay). ──
  recordedMoves?: RecordedMove[]
}

/** One saved "shot": a preset slot with an optional spoken label ("drummer"). */
export interface VoiceShot {
  id: number // OBSBOT preset slot 1–254
  label?: string // optional spoken label; joins the grammar. Empty = "shot <id>" only.
}

/** Saved shots per camera (active=1, second=2). Presence = the slot is set. */
export interface VoiceShotMap {
  1?: VoiceShot[]
  2?: VoiceShot[]
}

/** A recognized voice command (helper → BB → renderer toast / WS broadcast). */
export interface VoiceResult {
  ok: boolean // true = executed; false = rejected (low confidence / no match / unset shot)
  camera: 1 | 2 // which camera the command targeted (active if no prefix spoken)
  verb: string // canonical verb id (pushIn, slowPushIn, pullOut, zoomIn, wide, sweep, track, stop, recall, select)
  target?: string // shot token / label, when present
  text: string // human display string for the toast, e.g. "CAM2 ▸ PUSH IN"
  confidence: number // 0–1
  reason?: string // rejection reason when ok=false
}

/** Helper process / engine status pushed to the renderer. */
export interface VoiceStatus {
  helper: 'starting' | 'ready' | 'down' // child-process state
  listening: boolean // true while the PTT key is held (or continuously, in wake mode)
  wake?: boolean // true when hands-free wake-word mode is active
  lastResult?: VoiceResult
}

// ── Shot recorder (motion record/replay) ─────────────────────────────────────
/** One timestamped pose-affecting command captured during a recording. */
export interface RecordedMoveEvent {
  tMs: number // ms since recording start
  camera: 1 | 2
  kind: string // gimbal | gimbalStop | zoom | zoomStop | slowPush | slowPull | recall
  args?: Record<string, number | string>
}

/** A saved manual "move": a timed command list, replayable open-loop. */
export interface RecordedMove {
  id: number
  label?: string // optional spoken/typed name; joins the voice grammar
  durationMs: number
  events: RecordedMoveEvent[]
  createdAt: string // ISO
}

/** Recorder status pushed to the renderer. */
export interface ShotRecorderState {
  recording: boolean
  replayingMoveId: number | null
  eventCount: number // live count while recording
}

// ── Operator Chat (Supabase Realtime, config-injected, off by default) ──────
// Realtime chat between event operators (control room ↔ booth) with the ability
// to "pin" a message as an on-screen lower-third broadcast. Dormant until the
// user supplies a BB-specific Supabase project + flips `enabled`. See the schema
// comment at the top of src/main/services/chatBridge.ts for the required SQL.

export interface ChatConfig {
  supabaseUrl: string   // e.g. https://xxxx.supabase.co
  supabaseAnonKey: string
  eventId: string       // scopes messages to a single event
  enabled: boolean      // gate — when false the chat code path never runs
  bannedAuthors?: string[] // moderation: authors whose messages are filtered out
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  eventId: '',
  enabled: false,
  bannedAuthors: [],
}

export interface ChatMessage {
  id: string
  author: string
  text: string
  pinned: boolean       // operator-only pin
  hidden?: boolean      // moderation: dropped from the rendered list
  livestreamPinned?: boolean // flagged for the PUBLIC livestream overlay
  createdAt: number // epoch ms
}

export interface ChatState {
  connected: boolean
  enabled: boolean
  messages: ChatMessage[]
  pinned: ChatMessage[]            // operator pins
  livestreamPinned: ChatMessage[]  // public-overlay pins (max 3)
  bannedAuthors: string[]
}

// ── CC→BB Live Relay (Supabase Realtime broadcast, config-injected, dormant) ──
// CC (on Vercel) can't WS-push to the operator's local BB. Instead CC publishes
// on a Supabase Realtime *broadcast* channel `bb:<tenantId>:<eventId>`; BB
// subscribes via the anon key. Dormant until a package's `realtime` block arms
// it (or it's explicitly init'd). See src/main/services/ccRelay.ts.

export interface CcRelayConfig {
  enabled: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  tenantId: string
  eventId: string
  // Optional CC viewer-chat feed channel ('livestream:<streamEventId>'). When
  // present, ccRelay subscribes a SECOND channel and forwards CC 'chat' events
  // into chatBridge's store so the operator ChatPanel renders them. Absent =
  // dormant (no 2nd subscription).
  chatChannel?: string
}

export interface CcRelayState {
  connected: boolean
  enabled: boolean
  channel: string // 'bb:<tenantId>:<eventId>' when configured, else ''
}

// ── Operator Day Checklist (start-of-day / end-of-day) ──────────────────────
// The operator's OWN pre-show setup / post-show teardown list — distinct from
// the CC-pushed broadcast-package checklist. Item definitions are static in
// src/main/services/dayChecklistItems.ts; per-day check/skip/na state persists
// to userData/broadcastbuddy-day-checklist.json.

export type DayChecklistKind = 'start' | 'end'

export type DayChecklistItemState = 'open' | 'checked' | 'skipped' | 'na'

export interface DayChecklistItem {
  id: string
  label: string
  detail?: string
}

export interface DayChecklistDayState {
  date: string // YYYY-MM-DD (operator-local)
  items: Record<string, DayChecklistItemState>
  dismissed: boolean
  lastUpdatedAt: number // epoch ms
}

export interface DayChecklistPersistedState {
  days: Record<string, DayChecklistDayState> // keyed by "<date>|<kind>"
}

// Payload returned to the renderer when it asks for / opens a checklist.
export interface DayChecklistView {
  kind: DayChecklistKind
  date: string
  items: DayChecklistItem[]
  state: DayChecklistDayState
}

// ── Slow Zoom (OBS Move Transition driver) ──────────────────────
// Operator pre-creates in OBS:
//   - A pair of scenes per camera ("Wide" + "Wide Zoomed", "Tight" + "Tight Zoomed")
//     where the zoomed scene has the same camera source at +~10% scale.
//   - One Move Transition (e.g. "Slow Zoom") that interpolates between scene
//     items frame-perfect at OBS render rate. The Move plugin's own duration
//     setting is overridden per-fire by BB (10s by default).
// Two UI buttons (Wide + Tight) — each toggles its own scene's zoom state
// independently. If the named transition or scenes don't exist in OBS the
// fire fails soft with a warning.

export interface SlowZoomSettings {
  transitionName: string        // Move Transition name (default "Slow Zoom")
  wideBaseScene: string         // (default "Wide")
  wideZoomedScene: string       // (default "Wide Zoomed")
  tightBaseScene: string        // (default "Tight")
  tightZoomedScene: string      // (default "Tight Zoomed")
  durationMs: number            // (default 10000)
}

export const DEFAULT_SLOW_ZOOM: SlowZoomSettings = {
  transitionName: 'Slow Zoom',
  wideBaseScene: 'Wide',
  wideZoomedScene: 'Wide Zoomed',
  tightBaseScene: 'Tight',
  tightZoomedScene: 'Tight Zoomed',
  durationMs: 10_000,
}

export interface SlowZoomStatus {
  wideZoomedIn: boolean
  tightZoomedIn: boolean
}

// ── WiFi Display (tablet stream) ─────────────────────────────────

export interface MonitorInfo {
  id: number
  label: string
  width: number
  height: number
  x: number
  y: number
}

export interface WifiDisplayState {
  running: boolean
  monitorIndex: number | null
}

export interface WifiDisplaySettings {
  monitorIndex: number | null
  bitrate: number
  fps: number
  clientIp: string | null
  videoPort: number
  touchPort: number
  autoStart: boolean
  // 'openh264' = software encoder (default, always works). 'hevc-nvenc' = GPU
  // offload via bundled ffmpeg; tablet must also flip to video/hevc MediaCodec.
  encoder?: 'openh264' | 'hevc-nvenc'
}

// Wi-Fi Direct (no-router) hotspot mode. Brings up the Windows Mobile Hotspot
// so a tablet can join with no router; existing UDP-5002 discovery + streaming
// then work unchanged on the 192.168.137.x subnet.
export interface DirectModeStatus {
  active: boolean
  ssid: string
  passphrase: string
  hostIp: string
  error?: string
  // QR payload JSON string the renderer encodes (present when active).
  qrPayload?: string
}

// EXPERIMENTAL / UNVERIFIED — true Wi-Fi Direct P2P (Wi-Fi P2P). The host only
// starts a Wi-Fi Direct *advertisement* (scaffold); full group-owner + socket
// handling needs a native helper. Isolated from DirectModeStatus above.
export interface WifiDirectP2PStatus {
  active: boolean
  // WiFiDirectAdvertisementPublisher.Status string, when the start succeeded.
  publisherStatus?: string
  error?: string
}

// EXPERIMENTAL / UNVERIFIED — Option 2 "BLE auto-list" no-router pairing.
// Status of the best-effort Windows BLE advertisement that broadcasts the
// Direct-mode hotspot creds so a tablet can list the host with no QR scan.
// Isolated from DirectModeStatus / the QR path.
export interface BleAdvertiseStatus {
  active: boolean
  error?: string
}

export const DEFAULT_WIFI_DISPLAY: WifiDisplaySettings = {
  monitorIndex: null,
  bitrate: 3000,
  fps: 30,
  clientIp: null,
  videoPort: 5000,
  touchPort: 5001,
  autoStart: false,
  encoder: 'openh264',
}

// ── Checklist Item (from Command Center) ─────────────────────────

export interface CCChecklistItem {
  id: string
  label: string
  checked: boolean
  category: string
  sortOrder: number
}

// ── Broadcast Package (from Command Center) ──────────────────────

export interface BroadcastPackage {
  eventId: string
  version: string
  generatedAt: string
  event: {
    eventName: string
    eventType: string
    venueName: string
    eventDate: string
  }
  client: {
    organization: string
    brandColor: string | null
    logoUrl?: string | null
  }
  company: {
    name: string | null
    logoUrl: string | null
    primaryColor: string | null
    secondaryColor: string | null
  }
  triggers: Array<{
    type: 'title_card' | 'lower_third' | 'feature'
    name: string
    title?: string
    subtitle?: string
    category?: string
    logoUrl?: string | null
    shiftName?: string
  }>
  checklist: CCChecklistItem[]
  overlayConfig: Record<string, unknown> | null
  streaming: {
    streamKey: string | null
    rtmpUrl: string | null
    livestreamUrl: string | null
    embedCode: string | null
  }
  drive?: {
    eventFolderId: string | null
    eventFolderUrl: string | null
    clientFolderId: string | null
    clientFolderUrl: string | null
  }
  // CC→BB live relay coordinates. When present (both url + anon key), applying
  // the package auto-arms ccRelay so subsequent CC pushes land live. Omitted on
  // old packages / when CC's Supabase env is unset → relay stays dormant.
  realtime?: {
    channel?: string // 'bb:<tenantId>:<eventId>' (informational)
    supabaseUrl: string
    supabaseAnonKey: string
    // CC viewer-chat feed channel ('livestream:<streamEventId>'). Config-driven;
    // arms ccRelay's 2nd subscription so the operator ChatPanel shows CC chat.
    chatChannel?: string
  }
}

export interface CCEvent {
  id: string
  eventName: string
  eventType: string
  venueName: string
  loadInTime: string
  status: string
  client: { organization: string }
}

// ── OBS Recording + Audio Meters ─────────────────────────────────

export interface RecordState {
  active: boolean
  paused: boolean
  timecode: string // HH:MM:SS.mmm from OBS, or empty
}

// Live OBS stream + replay-buffer state (pushed on StreamStateChanged).
export interface StreamState {
  streaming: boolean
  replayBufferActive: boolean
}

// ── System monitor (CPU/RAM/disk) ────────────────────────────────────────────
// Pure os/fs polling (no npm deps). Pushed to the renderer ~every 5s so the
// operator sees machine health during a long recording/stream.
export interface SystemStats {
  cpuPercent: number
  memPercent: number
  diskFreeGB: number
  diskTotalGB: number
  driveLost: boolean // watched output drive missing / unreadable
  timestamp: number // epoch ms
}

export type DiskAlertLevel = 'ok' | 'warning' | 'high' | 'critical' | 'drive-lost'

export interface DiskAlert {
  level: DiskAlertLevel
  diskFreeGB: number
  message: string
}

// ── Global hotkeys (Electron globalShortcut accelerators) ─────────────────────
// Empty string = unbound. Work even when the app is unfocused.
export interface HotkeyConfig {
  fireLowerThird: string
  hideLowerThird: string
  nextTrigger: string
  prevTrigger: string
  toggleRecording: string
  saveReplay: string
  /** "Go Wide / Panic" — recall the camera Home preset (AI off). No-op without a cameraHost. */
  cameraGoHome: string
}

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  fireLowerThird: 'F9',
  hideLowerThird: 'F10',
  nextTrigger: 'F6',
  prevTrigger: 'F5',
  toggleRecording: 'F7',
  saveReplay: 'F8',
  // F4 — instant camera-wide / panic. Unused elsewhere (F5–F10 are taken above).
  cameraGoHome: 'F4',
}

// ── Stream Deck plugin installer status ──────────────────────────────────────
export interface StreamDeckStatus {
  streamDeckInstalled: boolean // Elgato plugins dir exists
  pluginsDir: string | null
  pluginInstalled: boolean
  bundledAvailable: boolean
  supported: boolean // false on non-Windows (installer is Windows-only)
}

// One OBS audio input's post-fader peak per channel, as a 0..1 multiplier
// (OBS magnitude). Renderer converts to dBFS for display.
export interface AudioInputLevel {
  inputName: string
  levels: number[]
}

// ── Operator Resilience (event log / crash recovery / startup / backup) ──────

export type EventLogKind = 'session' | 'overlay' | 'obs' | 'wifi' | 'gallery' | 'chat' | 'cc' | 'system' | 'error'

export interface EventLogRecord {
  t: string // ISO timestamp
  kind: EventLogKind
  message: string
  meta?: Record<string, unknown>
}

export interface RecoveryStatus {
  available: boolean
  triggerCount: number
  sessionName: string | null
  lastActive: string | null // ISO
}

export type StartupCheckStatus = 'ok' | 'warn' | 'fail'

export interface StartupCheck {
  name: string
  status: StartupCheckStatus
  detail: string
}

export interface StartupReport {
  ranAt: string // ISO
  checks: StartupCheck[]
}

export interface BackupInfo {
  file: string // basename
  createdAt: string // ISO
  size: number
}

// ── IPC Channels ─────────────────────────────────────────────────

export const IPC = {
  // Overlay control
  OVERLAY_FIRE_LT: 'overlay:fire-lt',
  OVERLAY_HIDE_LT: 'overlay:hide-lt',
  OVERLAY_FIRE_ADHOC: 'overlay:fire-adhoc',     // (title, subtitle) → one-off lower-third
  OVERLAY_GET_LAST_ADHOC: 'overlay:get-last-adhoc',
  OVERLAY_LAST_ADHOC_UPDATE: 'overlay:last-adhoc', // main → renderer push on each ad-hoc fire
  OVERLAY_GET_STATE: 'overlay:get-state',
  OVERLAY_UPDATE_STYLING:'overlay:update-styling',
  OVERLAY_SET_LOGOS: 'overlay:set-logos',
  OVERLAY_SET_FC_LOGO: 'overlay:set-fc-logo', // persistent graphics/feature-card logo (data URL or '')
  OVERLAY_GET_FC_LOGO: 'overlay:get-fc-logo',

  // Trigger management
  TRIGGER_LIST: 'trigger:list',
  TRIGGER_ADD: 'trigger:add',
  TRIGGER_UPDATE: 'trigger:update',
  TRIGGER_DELETE: 'trigger:delete',
  TRIGGER_REORDER: 'trigger:reorder',
  TRIGGER_SELECT: 'trigger:select',
  TRIGGER_NEXT: 'trigger:next',
  TRIGGER_PREV: 'trigger:prev',
  TRIGGER_NEXT_FULL: 'trigger:next-full',
  TRIGGER_SET_LOGO: 'trigger:set-logo',

  // Playlist
  PLAYLIST_AUTO_FIRE: 'playlist:auto-fire-toggle',
  PLAYLIST_GET_STATUS: 'playlist:get-status',
  PLAYLIST_SET_LOOP_MODE:'playlist:set-loop-mode',
  PLAYLIST_RESET_POSITION:'playlist:reset-position',
  PLAYLIST_CLEAR_PLAYED: 'playlist:clear-played',

  // Trigger bulk
  TRIGGER_CLEAR_ALL: 'trigger:clear-all',

  // Session management
  SESSION_NEW: 'session:new',
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_LIST: 'session:list',
  SESSION_GET_CURRENT: 'session:get-current',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_BROWSE_FILE: 'settings:browse-file',

  // Logo
  LOGO_BROWSE: 'logo:browse',

  // Document import
  IMPORT_BROWSE: 'import:browse',
  IMPORT_PREVIEW: 'import:preview',
  IMPORT_DOCUMENT: 'import:document',
  IMPORT_APPLY_MAPPING: 'import:apply-mapping',
  IMPORT_SAVE_PRESET: 'import:save-preset',
  IMPORT_LOAD_PRESET: 'import:load-preset',

  // Ticker
  TICKER_SHOW: 'ticker:show',
  TICKER_HIDE: 'ticker:hide',
  TICKER_UPDATE: 'ticker:update',

  // Brand scraper
  BRAND_SCRAPE: 'brand:scrape',
  BRAND_SCRAPE_AI: 'brand:scrape-ai',
  BRAND_FETCH_LOGO: 'brand:fetch-logo', // remote image URL → base64 data URL

  // User presets (operator-saved StylePresets, alongside built-in PRESETS)
  USER_PRESETS_LIST: 'user-presets:list',
  USER_PRESETS_ADD: 'user-presets:add',
  USER_PRESETS_DELETE: 'user-presets:delete',

  // Window
  WINDOW_RESIZE: 'window:resize',

  // Stream config
  STREAM_CONFIG_GET: 'stream:config-get',
  STREAM_CONFIG_SET: 'stream:config-set',

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_ADD: 'notes:add',
  NOTES_DELETE: 'notes:delete',

  // OBS connection
  OBS_CONNECT: 'obs:connect',
  OBS_DISCONNECT: 'obs:disconnect',
  OBS_STATUS: 'obs:status',
  OBS_GET_TIMECODE: 'obs:get-timecode',
  OBS_PUSH_STREAM_KEY: 'obs:push-stream-key',

  // OBS stream control + replay buffer (ported from CompSync)
  OBS_START_STREAM: 'obs:start-stream',
  OBS_STOP_STREAM: 'obs:stop-stream',
  OBS_SAVE_REPLAY: 'obs:save-replay',
  OBS_STREAM_STATUS: 'obs:stream-status',
  OBS_STREAM_STATE_UPDATE: 'obs:stream-state-update', // main → renderer push
  OBS_REPLAY_SAVED: 'obs:replay-saved', // main → renderer push

  // System monitor (CPU/RAM/disk) + alerts
  SYSTEM_GET_STATS: 'system:get-stats',
  SYSTEM_STATS: 'system:stats', // main → renderer push (~5s)
  SYSTEM_DISK_ALERT: 'system:disk-alert', // main → renderer push

  // Stream Deck plugin in-app installer
  STREAMDECK_GET_STATUS: 'streamdeck:get-status',
  STREAMDECK_INSTALL_PLUGIN: 'streamdeck:install-plugin',

  // OBS recording control (start/stop/toggle + live state push)
  OBS_START_RECORD: 'obs:start-record',
  OBS_STOP_RECORD: 'obs:stop-record',
  OBS_TOGGLE_RECORD: 'obs:toggle-record',
  OBS_RECORD_STATUS: 'obs:record-status',
  OBS_RECORD_STATE_UPDATE: 'obs:record-state-update', // main → renderer push

  // OBS audio meters (InputVolumeMeters, throttled push)
  OBS_AUDIO_LEVELS: 'obs:audio-levels', // main → renderer push

  // Starting soon
  STARTING_SOON_SHOW: 'starting-soon:show',
  STARTING_SOON_HIDE: 'starting-soon:hide',
  STARTING_SOON_UPDATE: 'starting-soon:update',

  // Command Center broadcast package
  CC_FETCH_EVENTS: 'cc:fetch-events',
  CC_FETCH_PACKAGE: 'cc:fetch-package',
  CC_APPLY_PACKAGE: 'cc:apply-package',
  CC_UPLOAD_RECORDING: 'cc:upload-recording',
  CC_SYNC_CHECKLIST: 'cc:sync-checklist',
  CC_SAVE_OVERLAY_CONFIG: 'cc:save-overlay-config',
  CC_FETCH_CHECKLIST: 'cc:fetch-checklist',

  // OBS recording
  OBS_GET_LAST_RECORDING: 'obs:get-last-recording',
  RECORDING_BROWSE: 'recording:browse',

  // Gallery / Photo Sorting
  GALLERY_BROWSE_VIDEO: 'gallery:browse-video',
  GALLERY_BROWSE_PHOTOS: 'gallery:browse-photos',
  GALLERY_ANALYZE_VIDEO: 'gallery:analyze-video',
  GALLERY_READ_EXIF: 'gallery:read-exif',
  GALLERY_MATCH_PHOTOS: 'gallery:match-photos',
  GALLERY_SET_OFFSET: 'gallery:set-offset',
  GALLERY_GET_CONFIG: 'gallery:get-config',
  GALLERY_UPLOAD_TO_CC: 'gallery:upload-to-cc',
  GALLERY_BROWSE_VIDEOS: 'gallery:browse-videos',
  GALLERY_TRANSCRIBE: 'gallery:transcribe',
  GALLERY_UPLOAD_R2: 'gallery:upload-r2',
  GALLERY_RUN_PIPELINE_V2: 'gallery:run-pipeline-v2',
  GALLERY_PROGRESS: 'gallery:progress',

  // State sync (main - renderer push events)
  STATE_UPDATE: 'state:update',
  OVERLAY_STATE_UPDATE: 'overlay:state-update',
  TRIGGERS_UPDATED: 'triggers:updated',
  SESSION_UPDATED: 'session:updated',

  // WiFi Display (tablet stream)
  WIFI_DISPLAY_GET_MONITORS: 'wifi-display:get-monitors',
  WIFI_DISPLAY_START: 'wifi-display:start',
  WIFI_DISPLAY_STOP: 'wifi-display:stop',
  WIFI_DISPLAY_STATUS: 'wifi-display:status',
  WIFI_DISPLAY_SET_MONITOR: 'wifi-display:set-monitor',
  WIFI_DISPLAY_PING_TABLET: 'wifi-display:ping-tablet',

  // Wi-Fi Direct (no-router) hotspot mode
  DIRECT_MODE_START: 'direct-mode:start',
  DIRECT_MODE_STOP: 'direct-mode:stop',
  DIRECT_MODE_STATUS: 'direct-mode:status',

  // EXPERIMENTAL / UNVERIFIED — true Wi-Fi Direct P2P (host advertiser scaffold).
  WIFI_DIRECT_P2P_START: 'wifi-direct-p2p:start',
  WIFI_DIRECT_P2P_STOP: 'wifi-direct-p2p:stop',
  WIFI_DIRECT_P2P_STATUS: 'wifi-direct-p2p:status',

  // EXPERIMENTAL / UNVERIFIED — Option 2 "BLE auto-list" no-router pairing.
  // Best-effort Windows BLE advertisement of the Direct-mode hotspot creds.
  BLE_ADVERTISE_START: 'ble-advertise:start',
  BLE_ADVERTISE_STOP: 'ble-advertise:stop',
  BLE_ADVERTISE_STATUS: 'ble-advertise:status',

  // OBS Slow Zoom (Move Transition driver)
  OBS_SLOW_ZOOM_TRIGGER_WIDE: 'obs:slow-zoom-trigger-wide',
  OBS_SLOW_ZOOM_TRIGGER_TIGHT: 'obs:slow-zoom-trigger-tight',
  OBS_SLOW_ZOOM_STATUS: 'obs:slow-zoom-status',
  OBS_SLOW_ZOOM_STATUS_UPDATE: 'obs:slow-zoom-status-update', // main → renderer push

  // OBSBOT camera safety (guarded — no-op unless cameraHost is set)
  CAMERA_SET_HOME: 'camera:set-home', // store current pose as wide Home preset
  CAMERA_GO_HOME: 'camera:go-home',   // safety/panic → recall wide Home, AI off

  // OBSBOT camera — connection probe + manual control (guarded; no-op unless the
  // camera feature is active). Backs a future PTZ control panel (later wave).
  CAMERA_PROBE: 'camera:probe',                 // connectivity check → status
  CAMERA_NUDGE: 'camera:nudge',                 // gimbal velocity / stop
  CAMERA_ZOOM: 'camera:zoom',                   // ramp zoom to target
  CAMERA_RECENTER: 'camera:recenter',           // reset gimbal to centre
  CAMERA_RECALL_PRESET: 'camera:recall-preset', // recall stored preset n
  CAMERA_SAVE_PRESET: 'camera:save-preset',     // store current pose as preset id
  CAMERA_DELETE_PRESET: 'camera:delete-preset', // delete stored preset id
  CAMERA_SET_AUTO_MODE: 'camera:set-auto-mode', // persist auto-mode opt-in
  CAMERA_SET_TRACKING_SPEED: 'camera:set-tracking-speed', // OBSBOT track-speed mode
  CAMERA_IMAGE_CONTROL: 'camera:image-control', // manual white balance / exposure / focus
  CAMERA_CONTROL: 'camera:control', // tracking speed / AI mode / framing tier / only-me / zoom level

  // OBSBOT camera — PTZ control panel (Wave 2/3). High-rate joystick/gamepad path
  // + zoom velocity + AI interlock + live state readout. All guarded; no-op when
  // the camera feature is inactive.
  CAMERA_NUDGE_XY: 'camera:nudge-xy',           // 2D gimbal velocity / stop (joystick + gamepad)
  CAMERA_ZOOM_VELOCITY: 'camera:zoom-velocity', // hold-to-zoom velocity / stop
  CAMERA_SET_AI_ENABLE: 'camera:set-ai-enable', // master AI tracking on/off (interlock + toggle)
  CAMERA_GET_STATE: 'camera:get-state',         // live gimbal/zoom readout (never throws)
  CAMERA_DISCOVER: 'camera:discover',           // scan local subnets for the OBSBOT → auto-set cameraHost
  CAMERA_APPLY_CURRENT: 'camera:apply-current', // re-apply current routine framing (AUTO-enable → real tracking)
  CAMERA_SELECT: 'camera:select',               // multi-cam: set which PTZ (1|2) the controls drive

  // Voice-driven PTZ director (push-to-talk → offline SAPI grammar). Guarded; no-op
  // unless voiceEnabled. See voiceDirector.ts.
  GAMEPAD_XINPUT: 'gamepad:xinput',              // main→renderer: XInput pad state (works unfocused)
  UPDATE_CHECK: 'update:check',                  // read R2 latest.json → UpdateStatus
  UPDATE_INSTALL: 'update:install',              // download+verify app.asar, quit, swap, relaunch

  VOICE_PTT: 'voice:ptt',                        // push-to-talk down/up (renderer test button; deck uses WS)
  VOICE_REFRESH_GRAMMAR: 'voice:refresh-grammar',// rebuild + push SAPI grammar (after shot labels change)
  VOICE_GET_STATUS: 'voice:get-status',          // current helper/listening status (never throws)
  VOICE_STATE: 'voice:state',                    // main→renderer push: VoiceStatus (helper state + last result)

  // Per-camera PTZ control (multi-PTZ / dual-Xbox: left stick→cam1, right stick→cam2).
  CAMERA_NUDGE_XY_FOR: 'camera:nudge-xy-for',     // {camera, yaw, pitch, stop?}
  CAMERA_ZOOM_VELOCITY_FOR: 'camera:zoom-velocity-for', // {camera, dir, speed, stop?}
  CAMERA_SLOW_ZOOM_FOR: 'camera:slow-zoom-for',   // {camera, ms?, factor?}
  CAMERA_RECALL_PRESET_FOR: 'camera:recall-preset-for', // {camera, n}
  CAMERA_STOP_FOR: 'camera:stop-for',             // {camera} — halt all motion on one camera
  CAMERA_SET_AI_ENABLE_FOR: 'camera:set-ai-enable-for', // {camera, on} — per-camera AI on/off (Xbox interlock)
  CAMERA_PRESET_IDS: 'camera:preset-ids',         // {camera} → preset slot ids stored ON the camera (verify badge)
  CAMERA_SWEEP_WAYPOINTS: 'camera:sweep-waypoints', // {ids[], ms} — glide across ordered real presets

  // Shot recorder (motion record/replay → recallable by voice/hotkey/deck).
  SHOT_RECORD_TOGGLE: 'shot:record-toggle',       // start/stop recording (label? on stop)
  SHOT_REPLAY: 'shot:replay',                     // {id} replay a recorded move
  SHOT_DELETE: 'shot:delete',                     // {id}
  SHOT_RENAME: 'shot:rename',                     // {id, label}
  SHOT_GET: 'shot:get',                           // list moves + state
  SHOT_STATE: 'shot:state',                       // main→renderer push: ShotRecorderState

  // OBS Transition auto-revert (snap back to Cut 500ms after any transition)
  OBS_TRANSITION_REVERT_GET: 'obs:transition-revert-get',
  OBS_TRANSITION_REVERT_SET: 'obs:transition-revert-set',

  // Up Next / That Was (fire neighbouring trigger with a label prefix)
  OVERLAY_FIRE_UP_NEXT: 'overlay:fire-up-next',
  OVERLAY_FIRE_THAT_WAS: 'overlay:fire-that-was',

  // On-air clock (broadcast-chrome wall clock)
  OVERLAY_CLOCK_TOGGLE: 'overlay:clock-toggle',
  OVERLAY_CLOCK_UPDATE: 'overlay:clock-update',

  // Counter (numeric badge)
  OVERLAY_COUNTER_TOGGLE: 'overlay:counter-toggle',
  OVERLAY_COUNTER_SET: 'overlay:counter-set',   // value + label
  OVERLAY_COUNTER_BUMP: 'overlay:counter-bump',  // delta

  // Full-screen feature card (UP NEXT / THAT WAS / featured)
  OVERLAY_FEATURE_SHOW: 'overlay:feature-show',
  OVERLAY_FEATURE_UP_NEXT: 'overlay:feature-up-next',
  OVERLAY_FEATURE_THAT_WAS: 'overlay:feature-that-was',
  OVERLAY_FEATURE_HIDE: 'overlay:feature-hide',

  // On-stream pinned chat-message overlay (CC viewer chat)
  OVERLAY_SHOW_CHAT_MESSAGE: 'overlay:show-chat-message', // ({author,text} show) | (null/pinned:false hide)
  OVERLAY_HIDE_CHAT_MESSAGE: 'overlay:hide-chat-message',

  // Overlay leveling grid (operator-only rule-of-thirds)
  OVERLAY_GRID_TOGGLE: 'overlay:grid-toggle',

  // Operator chat (Supabase Realtime, config-injected, off by default)
  CHAT_GET_STATE: 'chat:get-state',
  CHAT_SEND: 'chat:send',
  CHAT_PIN: 'chat:pin',
  CHAT_UNPIN: 'chat:unpin',
  CHAT_FIRE_MESSAGE: 'chat:fire-message', // broadcast a message as a lower-third
  CHAT_RECONFIGURE: 'chat:reconfigure',   // renderer asks main to (re)init from saved settings
  CHAT_STATE_UPDATE: 'chat:state-update', // main → renderer push
  // Chat moderation
  CHAT_HIDE: 'chat:hide',                   // hide a message from the rendered list
  CHAT_BAN_AUTHOR: 'chat:ban-author',       // ban an author (filtered + existing hidden)
  CHAT_UNBAN_AUTHOR: 'chat:unban-author',   // lift a ban
  CHAT_LIVESTREAM_PIN: 'chat:livestream-pin',     // pin for the PUBLIC livestream overlay
  CHAT_LIVESTREAM_UNPIN: 'chat:livestream-unpin',

  // CC→BB live relay (Supabase Realtime broadcast, dormant until a package arms it)
  CC_RELAY_GET_STATE: 'cc:relay-get-state',
  CC_RELAY_STATE_UPDATE: 'cc:relay-state', // main → renderer push
  // Test/diagnostic hook: simulate an inbound 'overlay-config' relay broadcast,
  // applying an OverlayStyling-shaped payload to the live overlay styling.
  CC_RELAY_APPLY_OVERLAY_CONFIG: 'cc:relay-apply-overlay-config',

  // Operator day checklist (start-of-day / end-of-day)
  DAY_CHECKLIST_GET: 'day-checklist:get',          // (date, kind) → DayChecklistView
  DAY_CHECKLIST_SET_ITEM: 'day-checklist:set-item', // (date, kind, itemId, value)
  DAY_CHECKLIST_DISMISS: 'day-checklist:dismiss',   // (date, kind)
  DAY_CHECKLIST_REOPEN: 'day-checklist:reopen',     // (kind) → DayChecklistView for today
  DAY_CHECKLIST_SHOULD_SHOW: 'day-checklist:should-show', // → boolean (first launch of new day)

  // Operator event log / telemetry
  EVENTS_GET_RECENT: 'events:get-recent',
  EVENTS_NEW: 'events:new', // main → renderer push

  // Crash recovery
  RECOVERY_CHECK: 'recovery:check',
  RECOVERY_RESTORE: 'recovery:restore',
  RECOVERY_DISMISS: 'recovery:dismiss',

  // Startup checks
  STARTUP_REPORT: 'startup:report', // main → renderer push (+ fetchable)
  STARTUP_GET_REPORT: 'startup:get-report',

  // Settings backup
  BACKUP_NOW: 'backup:now',
  BACKUP_LIST: 'backup:list',
  BACKUP_RESTORE: 'backup:restore',

  // Overlay Mode — frameless always-on-top floating panels over OBS.
  // (Distinct from the streaming "overlay" / lower-thirds — shared word only.)
  OVERLAY_MODE_OPEN: 'overlay-mode:open',
  OVERLAY_MODE_CLOSE: 'overlay-mode:close',
  OVERLAY_MODE_TOGGLE: 'overlay-mode:toggle',
  OVERLAY_MODE_HIDE_PANEL: 'overlay-mode:hide-panel',
} as const

// ── WebSocket Protocol ───────────────────────────────────────────

export interface WsIdentifyMessage {
  type: 'identify'
  client: 'overlay' | 'streamdeck' | 'external'
}

export interface WsStateMessage {
  type: 'state'
  overlay: OverlayState
  playlist?: {
    current: number
    total: number
    autoFire: boolean
    upNextTitle: string | null
    upNextSubtitle?: string | null
    playedIds: string[]
    loopMode: LoopMode
  }
  // PTZ activity — lets deck faces + the tablet popup show live camera status
  // (record confirm, in-flight move, active-camera highlight). Optional so old
  // clients that don't know the block keep working unchanged.
  camera?: {
    activeCam: 1 | 2
    recording: boolean
    replayingMoveId: number | null
    sweepRunning: boolean
    bounceRunning: boolean
    recalling?: { cam: 1 | 2; slot: number } | null // last preset recall, until it has had time to arrive
  }
  health?: ShowHealth
  voice?: VoiceStatus
}

// Show-monitor alert state (showMonitor.ts) — rides the WS state message for the OBS dock.
export interface ShowAlert {
  id: string
  text: string
  since: number
  acked: boolean
}
export interface ShowHealth {
  obs: boolean
  recording: boolean
  recTimecode: string
  streaming: boolean
  cams: { 1: boolean | null; 2: boolean | null }
  alerts: ShowAlert[]
}

export interface WsCommandMessage {
  type: 'command'
  action: string
  data?: Record<string, unknown>
}

export interface WsBroadcastPackageMessage {
  type: 'broadcast_package'
  data: BroadcastPackage
}

export type WsMessage = WsIdentifyMessage | WsStateMessage | WsCommandMessage | WsBroadcastPackageMessage

// ── Gallery / Photo Sorting Types ────────────────────────────────

export interface RoutineBoundary {
  index: number // matches trigger order
  name: string // routine name from Gemini or trigger
  timestampStart: string // ISO date — start of routine in video
  timestampEnd: string // ISO date — end of routine in video
  videoOffsetStartSec: number // seconds from video start
  videoOffsetEndSec: number // seconds from video start
  description: string // Gemini's description (costume, group/solo, etc.)
  confidence: number // 0-1 Gemini confidence
}

export interface PhotoMatch {
  filePath: string
  thumbnailPath?: string
  captureTime: string // ISO — from EXIF
  confidence: 'exact' | 'gap' | 'pre-show' | 'intermission' | 'unmatched'
  matchedRoutineIndex?: number // index into RoutineBoundary array
  uploaded: boolean
}

export interface TranscriptSegment {
  start: number // seconds from audio start
  end: number
  text: string
  confidence?: number
}

export interface GalleryConfig {
  eventId: string // CC event ID (if linked)
  galleryId?: string // CC gallery ID (after creation)
  galleryUrl?: string // public URL
  videoPath: string // OBS recording path (legacy single-video)
  videoPaths: string[] // multiple video files (Act 1 + Act 2)
  photoFolderPath: string // SD card / photo folder
  clockOffsetMs: number // camera clock offset from system clock
  manualOffsetMs: number // user-provided offset override (e.g. -420000 for 7 min)
  routineBoundaries: RoutineBoundary[]
  transcriptionSegments?: TranscriptSegment[]
  photoMatches: PhotoMatch[]
  status: 'idle' | 'extracting-audio' | 'transcribing' | 'analyzing-video' | 'reading-exif' | 'matching' | 'uploading-r2' | 'registering' | 'uploading' | 'complete' | 'error'
  error?: string
}

export interface GalleryProgress {
  stage: GalleryConfig['status']
  message: string
  current: number
  total: number
}

export interface R2Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /**
   * Optional: run uploads through a child process to keep TLS encryption +
   * file I/O off the main process. Default false (main-process upload via
   * @aws-sdk/client-s3). Reserved for future hardening; not yet wired —
   * CompSync's worker assumes a pre-signed PUT URL pattern, but BB uses
   * bucket-credentialed S3 client, so the implementation needs the SDK to
   * be available inside the worker.
   */
  useChildProcessUpload?: boolean
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_STYLING: OverlayStyling = {
  fontFamily: "'Segoe UI', sans-serif",
  fontSize: 28,
  fontWeight: 600,
  textColor: '#ffffff',
  backgroundColor: '#1a1a2e',
  backgroundStyle: 'solid',
  accentColor: '#667eea',
  borderRadius: 8,
  animation: 'slide',
  animationDuration: 0.5,
  animationEasing: 'ease',
  autoHideSeconds: 8,
  titleTextTransform: 'none',
  titleLetterSpacing: 0,
  subtitleFontSize: 0, // 0 = derive from fontSize * 0.7
  subtitleColor: '',   // empty = inherit textColor
  textShadow: false,
  textGlow: false,
  labelColor: '#1a1a2e',
  labelBackgroundColor: '#667eea',
}

export const DEFAULT_STARTING_SOON_MEDIA: StartingSoonMedia = {
  sponsorLogos: [],
  sponsorIntervalSec: 6,
  slideshowPhotos: [],
  slideshowIntervalSec: 6,
  socialBar: '',
  welcomeLine: '',
  venueName: '',
  showSponsors: false,
  showSlideshow: false,
  showSocialBar: false,
  showWelcome: false,
  videoUrl: '',
  showVideo: false,
  showVisualizer: false,
}

export const DEFAULT_STARTING_SOON: StartingSoonState = {
  visible: false,
  title: 'Starting Soon',
  subtitle: '',
  countdownTarget: '',
  countdownSeconds: 0,
  showCountdown: true,
  completionText: "We're Live!",
  backgroundColor: '#1a1a2e',
  textColor: '#ffffff',
  accentColor: '#667eea',
  media: { ...DEFAULT_STARTING_SOON_MEDIA },
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  lowerThird: {
    visible: false,
    name: '',
    title: '',
    subtitle: '',
    label: '',
    styling: { ...DEFAULT_STYLING },
  },
  companyLogo: { visible: false, dataUrl: '' },
  clientLogo: { visible: false, dataUrl: '' },
  ticker: { visible: false, text: '', speed: 60, backgroundColor: '#1a1a2e', textColor: '#ffffff' },
  startingSoon: { ...DEFAULT_STARTING_SOON },
  clock: { visible: false, format: '12h', showSeconds: true },
  counter: { visible: false, value: 1, label: '' },
  featureCard: { visible: false, kicker: 'UP NEXT', title: '', subtitle: '', logoDataUrl: '', animateIn: 'slide-up', firedAt: 0 },
  chatMessage: { visible: false, author: '', text: '' },
  gridVisible: false,
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  streamKey: '',
  rtmpUrl: '',
  viewingLink: '',
  embedCode: '',
  chatLink: '',
}

/** In-app updater status (main/services/updater.ts → Settings → App Updates). */
export interface UpdateStatus {
  current: { commit: string; builtAt: string }
  latest: { commit: string; builtAt: string; bytes: number } | null
  available: boolean
  message: string
}
