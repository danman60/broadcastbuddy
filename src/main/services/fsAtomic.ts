import fs from 'fs'

// Crash-safe file write: write to a sibling temp file, fsync, then rename over
// the target. rename is atomic on the same filesystem, so a crash mid-write
// leaves either the old complete file or the new complete file — never a
// truncated one. Used for session + recovery-snapshot JSON where a half-written
// file would lose the data it was meant to protect.
export function writeFileAtomic(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, data, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}
