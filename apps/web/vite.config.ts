import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workspaceAliases } from '../../vite.shared.js'

export default defineConfig({
  plugins: [react()],
  // Workspace packages are consumed as TypeScript source via the shared alias map, so Vite,
  // Vitest and tsc all resolve them the same way. Divergence here is silent and expensive.
  resolve: { alias: workspaceAliases },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  preview: { port: 4173 },
})
