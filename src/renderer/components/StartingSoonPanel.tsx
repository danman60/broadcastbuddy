import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { StartingSoonState, StartingSoonMedia } from '../../shared/types'
import { DEFAULT_STARTING_SOON_MEDIA } from '../../shared/types'
import '../styles/startingSoon.css'

export function StartingSoonPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const [collapsed, setCollapsed] = useState(true)
  const [mediaCollapsed, setMediaCollapsed] = useState(true)
  const [mins, setMins] = useState(10)
  const [secs, setSecs] = useState(0)

  if (!overlayState) return null

  const ss = overlayState.startingSoon
  const media = ss.media ?? DEFAULT_STARTING_SOON_MEDIA

  function update(changes: Partial<StartingSoonState>) {
    window.api.startingSoonUpdate(changes)
  }

  function updateMedia(changes: Partial<StartingSoonMedia>) {
    update({ media: { ...media, ...changes } })
  }

  async function addSponsor() {
    const dataUrl = await window.api.logoBrowse()
    if (dataUrl) updateMedia({ sponsorLogos: [...media.sponsorLogos, dataUrl] })
  }

  function removeSponsor(idx: number) {
    updateMedia({ sponsorLogos: media.sponsorLogos.filter((_, i) => i !== idx) })
  }

  async function addPhoto() {
    const dataUrl = await window.api.logoBrowse()
    if (dataUrl) updateMedia({ slideshowPhotos: [...media.slideshowPhotos, dataUrl] })
  }

  function removePhoto(idx: number) {
    updateMedia({ slideshowPhotos: media.slideshowPhotos.filter((_, i) => i !== idx) })
  }

  function toggleShow() {
    if (ss.visible) {
      window.api.startingSoonHide()
    } else {
      window.api.startingSoonShow()
    }
  }

  function startCountdown() {
    const totalSecs = mins * 60 + secs
    if (totalSecs <= 0) return
    const target = new Date(Date.now() + totalSecs * 1000).toISOString()
    update({ countdownTarget: target, countdownSeconds: totalSecs })
  }

  function setPreset(minutes: number) {
    setMins(minutes)
    setSecs(0)
    const target = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    update({ countdownTarget: target, countdownSeconds: minutes * 60 })
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Starting Soon
        {ss.visible && <span className="ss-live-badge">LIVE</span>}
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="starting-soon-panel">
          <button
            className="btn btn-ghost btn-sm ss-open-editor"
            onClick={() => useStore.getState().setShowStartingSoonEditor(true)}
            title="Open the full-screen drag-and-design scene editor"
          >
            🎬 Open Scene Editor
          </button>

          {/* Title + Subtitle */}
          <div className="ss-field">
            <label>Title</label>
            <input
              type="text"
              value={ss.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Starting Soon"
            />
          </div>
          <div className="ss-field">
            <label>Subtitle</label>
            <input
              type="text"
              value={ss.subtitle}
              onChange={(e) => update({ subtitle: e.target.value })}
              placeholder="The show begins shortly..."
            />
          </div>
          <div className="ss-field">
            <label>Completion Text</label>
            <input
              type="text"
              value={ss.completionText}
              onChange={(e) => update({ completionText: e.target.value })}
              placeholder="We're Live!"
            />
            <span className="ss-hint">Shown when countdown reaches 00:00</span>
          </div>

          {/* Countdown */}
          <div className="ss-countdown-section">
            <label>
              <input
                type="checkbox"
                checked={ss.showCountdown}
                onChange={(e) => update({ showCountdown: e.target.checked })}
              />
              Show Countdown
            </label>
            {ss.showCountdown && (
              <>
                {/* Exact time input */}
                <div className="ss-time-input">
                  <div className="ss-time-field">
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={mins}
                      onChange={(e) => setMins(Math.max(0, Number(e.target.value)))}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>min</span>
                  </div>
                  <span className="ss-time-sep">:</span>
                  <div className="ss-time-field">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={secs}
                      onChange={(e) => setSecs(Math.min(59, Math.max(0, Number(e.target.value))))}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>sec</span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={startCountdown}>
                    Set
                  </button>
                </div>

                {/* Quick presets */}
                <div className="ss-countdown-presets">
                  {[5, 10, 15, 30].map((m) => (
                    <button
                      key={m}
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPreset(m)}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Colors */}
          <div className="ss-colors">
            <div className="ss-color-field">
              <label>BG</label>
              <input
                type="color"
                value={ss.backgroundColor}
                onChange={(e) => update({ backgroundColor: e.target.value })}
              />
            </div>
            <div className="ss-color-field">
              <label>Text</label>
              <input
                type="color"
                value={ss.textColor}
                onChange={(e) => update({ textColor: e.target.value })}
              />
            </div>
            <div className="ss-color-field">
              <label>Accent</label>
              <input
                type="color"
                value={ss.accentColor}
                onChange={(e) => update({ accentColor: e.target.value })}
              />
            </div>
          </div>

          {/* Pre-show media stack */}
          <div className={`ss-media-section${mediaCollapsed ? ' collapsed' : ''}`}>
            <div className="ss-media-header" onClick={() => setMediaCollapsed(!mediaCollapsed)}>
              Pre-Show Media
              <span className="chevron">{mediaCollapsed ? '▸' : '▾'}</span>
            </div>
            {!mediaCollapsed && (
              <div className="ss-media-body">
                {/* Welcome / venue */}
                <div className="ss-media-block">
                  <label className="ss-media-toggle">
                    <input
                      type="checkbox"
                      checked={media.showWelcome}
                      onChange={(e) => updateMedia({ showWelcome: e.target.checked })}
                    />
                    Welcome Line
                  </label>
                  <div className="ss-field">
                    <input
                      type="text"
                      value={media.welcomeLine}
                      onChange={(e) => updateMedia({ welcomeLine: e.target.value })}
                      placeholder="Welcome to the Spring Recital"
                    />
                  </div>
                  <div className="ss-field">
                    <input
                      type="text"
                      value={media.venueName}
                      onChange={(e) => updateMedia({ venueName: e.target.value })}
                      placeholder="Venue name"
                    />
                  </div>
                </div>

                {/* Social bar */}
                <div className="ss-media-block">
                  <label className="ss-media-toggle">
                    <input
                      type="checkbox"
                      checked={media.showSocialBar}
                      onChange={(e) => updateMedia({ showSocialBar: e.target.checked })}
                    />
                    Social Bar
                  </label>
                  <div className="ss-field">
                    <input
                      type="text"
                      value={media.socialBar}
                      onChange={(e) => updateMedia({ socialBar: e.target.value })}
                      placeholder="@studio • #recital2026 • site.com"
                    />
                  </div>
                </div>

                {/* Sponsor carousel */}
                <div className="ss-media-block">
                  <label className="ss-media-toggle">
                    <input
                      type="checkbox"
                      checked={media.showSponsors}
                      onChange={(e) => updateMedia({ showSponsors: e.target.checked })}
                    />
                    Sponsor Logos ({media.sponsorLogos.length})
                  </label>
                  <div className="ss-thumb-row">
                    {media.sponsorLogos.map((src, i) => (
                      <div key={i} className="ss-thumb">
                        <img src={src} alt="" />
                        <button className="ss-thumb-x" onClick={() => removeSponsor(i)} title="Remove">×</button>
                      </div>
                    ))}
                    <button className="btn btn-ghost btn-sm ss-add-media" onClick={addSponsor}>+ Add</button>
                  </div>
                  <div className="ss-media-interval">
                    <label>Rotate every</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={media.sponsorIntervalSec}
                      onChange={(e) => updateMedia({ sponsorIntervalSec: Math.max(1, Number(e.target.value)) })}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>sec</span>
                  </div>
                </div>

                {/* Photo slideshow */}
                <div className="ss-media-block">
                  <label className="ss-media-toggle">
                    <input
                      type="checkbox"
                      checked={media.showSlideshow}
                      onChange={(e) => updateMedia({ showSlideshow: e.target.checked })}
                    />
                    Photo Slideshow ({media.slideshowPhotos.length})
                  </label>
                  <div className="ss-thumb-row">
                    {media.slideshowPhotos.map((src, i) => (
                      <div key={i} className="ss-thumb">
                        <img src={src} alt="" />
                        <button className="ss-thumb-x" onClick={() => removePhoto(i)} title="Remove">×</button>
                      </div>
                    ))}
                    <button className="btn btn-ghost btn-sm ss-add-media" onClick={addPhoto}>+ Add</button>
                  </div>
                  <div className="ss-media-interval">
                    <label>Cross-fade every</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={media.slideshowIntervalSec}
                      onChange={(e) => updateMedia({ slideshowIntervalSec: Math.max(1, Number(e.target.value)) })}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>sec</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Show/Hide */}
          <button
            className={`btn btn-sm ss-toggle ${ss.visible ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleShow}
          >
            {ss.visible ? 'Hide Starting Soon' : 'Show Starting Soon'}
          </button>
        </div>
      )}
    </div>
  )
}
