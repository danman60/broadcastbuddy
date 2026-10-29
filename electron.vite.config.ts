import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'

export default defineConfig({
  main: {
    // Bundle @compsync/camera INTO the main process instead of leaving it an
    // external node_module. It's a `file:` junction to ../obsbot-control (outside
    // the project root), which electron-builder's asar packager refuses to walk.
    // Bundling inlines it under out/main; osc stays external (optional, lazy).
    plugins: [
      externalizeDepsPlugin({ exclude: ['@compsync/camera'] }),
      {
        name: 'check-dock-script',
        buildStart() {
          const script = resolve(__dirname, 'src/main/assets/dock.js')
          this.addWatchFile(script)
          this.parse(readFileSync(script, 'utf8'))
        },
      },
    ],
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
