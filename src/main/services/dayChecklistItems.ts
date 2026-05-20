/**
 * Static item definitions for the operator's Start-of-Day / End-of-Day
 * checklists.
 *
 * Unlike CompSyncElectronApp (which fetches its items from CompPortal), BB has
 * no remote item source — the lists are hardcoded operator setup/teardown
 * steps for a recital / corporate broadcast. They are intentionally generic so
 * any operator can use them without a CC connection.
 *
 * This is the operator's OWN gear/stream checklist — distinct from the
 * CC-pushed broadcast-package checklist surfaced in BroadcastPackagePanel.
 */

export interface ChecklistItem {
  id: string
  label: string
  detail?: string
}

export interface ChecklistItems {
  start: ChecklistItem[]
  end: ChecklistItem[]
}

const ITEMS: ChecklistItems = {
  start: [
    { id: 'obs-record-path', label: 'OBS recording to the correct drive', detail: 'Confirm the recording output folder points at the show drive, not the boot SSD.' },
    { id: 'audio-levels', label: 'Audio levels checked', detail: 'Confirm program audio peaks healthy (no clipping, no silence) on the OBS audio mixer.' },
    { id: 'stream-key', label: 'Stream key set', detail: 'RTMP server + stream key entered in OBS and pointed at the right destination.' },
    { id: 'overlay-loaded', label: 'Overlay browser source loaded', detail: 'OBS browser source shows the BroadcastBuddy overlay (test-fire a lower third).' },
    { id: 'tablet-connected', label: 'Tablet display connected', detail: 'WiFi display tablet is showing the control mirror and re-announces on ping.' },
    { id: 'session-loaded', label: 'Session / triggers loaded', detail: 'Correct event session loaded with the lower-third triggers for today.' },
  ],
  end: [
    { id: 'recording-stopped', label: 'Recording stopped', detail: 'OBS recording stopped and the final file finalized (faststart written).' },
    { id: 'stream-off', label: 'Stream stopped', detail: 'OBS streaming stopped — confirm the public feed shows offline.' },
    { id: 'files-backed-up', label: 'Recording files backed up', detail: 'Copy the day\'s recordings off the show drive to backup storage.' },
    { id: 'gallery-uploaded', label: 'Gallery / photos uploaded', detail: 'Run the Gallery pipeline (R2 / CC upload) if photos were shot.' },
    { id: 'gear-packed', label: 'Gear packed & charging', detail: 'Cameras, tablet, and power banks packed; batteries on charge for the next day.' },
  ],
}

export function getItems(): ChecklistItems {
  return ITEMS
}

export function getItemsForKind(kind: 'start' | 'end'): ChecklistItem[] {
  return kind === 'start' ? ITEMS.start : ITEMS.end
}
