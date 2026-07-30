// Browser-safe surface: schema, pure parsing, and markdown rendering. Filesystem helpers live
// in `./node` so bundling the app can never pull node:fs into the client.
export * from './schema.js'
export * from './parse.js'
export { renderMarkdown, ROADMAP_GENERATED_HEADER } from './generate.js'
