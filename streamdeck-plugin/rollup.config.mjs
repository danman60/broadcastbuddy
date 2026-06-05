import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/plugin.ts',
  output: {
    file: 'com.broadcastbuddy.streamdeck.sdPlugin/bin/plugin.js',
    format: 'es',
    sourcemap: true,
  },
  // ws MUST be bundled into plugin.js — the deployed .sdPlugin has no
  // node_modules beside it, so a bare `import ... from 'ws'` throws
  // ERR_MODULE_NOT_FOUND at launch and Stream Deck disables the plugin.
  // ws is CommonJS, so node-resolve + commonjs inline it (optional native
  // deps bufferutil/utf-8-validate are absent and ws degrades to pure JS).
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    typescript(),
  ],
}
