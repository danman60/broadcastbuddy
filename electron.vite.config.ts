import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { execSync } from 'child_process'

// Baked into main for the in-app updater (services/updater.ts).
const gitCommit = (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return '' } })()

export default defineConfig({
  main: {
    // Bundle @compsync/camera INTO the main process instead of leaving it an
    // external node_module. It's a `file:` junction to ../obsbot-control (outside
    // the project root), which electron-builder's asar packager refuses to walk.
    // Bundling inlines it under out/main; osc stays external (optional, lazy).
    plugins: [externalizeDepsPlugin({ exclude: ['@compsync/camera'] })],
    define: {
      __BB_COMMIT__: JSON.stringify(gitCommit),
      __BB_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html')
        }
      }
    }
  }
})
