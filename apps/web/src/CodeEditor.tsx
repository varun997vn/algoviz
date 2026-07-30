import { javascript } from '@codemirror/lang-javascript'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import CodeMirror from '@uiw/react-codemirror'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The editor, with a gutter highlight tracking the executing line.
 *
 * The current line comes from `Frame.line`, so scrubbing the player moves the highlight — which
 * is the bit that ties "the picture" back to "my code".
 */

const setHighlight = StateEffect.define<{ line: number | undefined; error: number | undefined }>()

const activeLine = Decoration.line({ class: 'cm-av-active-line' })
const errorLine = Decoration.line({ class: 'cm-av-error-line' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlight)) continue
      const ranges = []
      const doc = transaction.state.doc
      const { line, error } = effect.value
      if (line !== undefined && line >= 1 && line <= doc.lines) {
        ranges.push(activeLine.range(doc.line(line).from))
      }
      if (error !== undefined && error >= 1 && error <= doc.lines) {
        ranges.push(errorLine.range(doc.line(error).from))
      }
      next = Decoration.set(ranges, true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export interface CodeEditorProps {
  value: string
  onChange(next: string): void
  highlightLine?: number | undefined
  errorLine?: number | undefined
}

/** Follow the OS colour scheme so the editor never sits as a dark slab on a light page. */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent): void => setDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function CodeEditor({ value, onChange, highlightLine, errorLine }: CodeEditorProps): ReactNode {
  const viewRef = useRef<EditorView | null>(null)
  const dark = usePrefersDark()

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setHighlight.of({ line: highlightLine, error: errorLine }),
    })
  }, [highlightLine, errorLine])

  return (
    <div className="av-editor" data-testid="editor" data-active-line={highlightLine ?? ''}>
      <CodeMirror
        value={value}
        height="100%"
        theme={dark ? 'dark' : 'light'}
        // Wrapping rather than horizontal scrolling: a solution line that runs off the edge is
        // a line you stop reading, and these lines carry the instrumentation being taught.
        extensions={[javascript({ typescript: true }), highlightField, EditorView.lineWrapping]}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view
        }}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  )
}
