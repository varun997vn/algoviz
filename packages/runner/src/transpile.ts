import { transform } from 'sucrase'

export interface Diagnostic {
  message: string
  line?: number
  column?: number
}

export interface TranspileResult {
  code: string
  diagnostics: Diagnostic[]
}

export interface Transpiler {
  transform(source: string, filename: string): TranspileResult
}

/**
 * Sucrase, used in *both* the browser worker and Node.
 *
 * Chosen over esbuild-wasm for three reasons that all matter here: it is pure JS (no `.wasm`
 * asset to teach the bundler about), it is the same module in both environments (so the code
 * path an agent verifies headlessly is the code path the browser runs), and it is
 * non-reprinting — stripping types preserves line numbers 1:1, which is what lets runtime
 * error positions map back to the user's editor with a single constant offset instead of a
 * source map. Its Node-only helpers live in separate entry points (`register`, `cli`) that the
 * main entry never imports, so it bundles cleanly for the browser.
 */
export const sucraseTranspiler: Transpiler = {
  transform(source, filename) {
    try {
      const result = transform(source, {
        transforms: ['typescript'],
        disableESTransforms: true,
        filePath: filename,
      })
      return { code: result.code, diagnostics: [] }
    } catch (error) {
      return { code: '', diagnostics: [toDiagnostic(error)] }
    }
  },
}

function toDiagnostic(error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error)
  // Sucrase surfaces positions as "... (12:5)" on its SyntaxError messages.
  const match = /\((\d+):(\d+)\)/.exec(message)
  const diagnostic: Diagnostic = { message: message.replace(/^Error: /, '') }
  if (match) {
    diagnostic.line = Number(match[1])
    diagnostic.column = Number(match[2])
  }
  return diagnostic
}
