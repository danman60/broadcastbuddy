import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

export function createLogger(scope: string) {
  return {
    info: (...args: unknown[]) => log.info(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => log.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => log.error(`[${scope}]`, ...args),
    debug: (...args: unknown[]) => log.debug(`[${scope}]`, ...args),
  }
}

export default log
