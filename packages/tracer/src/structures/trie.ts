import type { Recorder } from '../recorder.js'
import type {
  Mark,
  MarkClass,
  NodeId,
  NodeMark,
  StructureKind,
  StructureSnapshot,
  TrieNodeSnapshot,
} from '../types.js'
import { BaseStructure, NodeMarkStore, type StructureInit } from './base.js'

interface TrieInternal {
  id: NodeId
  char: string
  terminal: boolean
  children: Map<string, TrieInternal>
}

/** A prefix tree. Insert and search both animate the walk down the branch. */
export class VizTrie extends BaseStructure {
  readonly kind: StructureKind = 'trie'
  private readonly nodes = new Map<NodeId, TrieInternal>()
  private readonly marks = new NodeMarkStore()
  private readonly rootNode: TrieInternal
  private counter = 0
  private pending: NodeMark[] | undefined

  constructor(rec: Recorder, words: readonly string[] = [], init: StructureInit = {}) {
    super(rec, 'tri', init.name, 'trie')
    this.rootNode = this.make('')
    rec.quiet(() => {
      for (const w of words) this.insert(w)
    })
  }

  private make(char: string): TrieInternal {
    this.counter += 1
    const node: TrieInternal = { id: `p${this.counter}`, char, terminal: false, children: new Map() }
    this.nodes.set(node.id, node)
    return node
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const nodes: TrieNodeSnapshot[] = [...this.nodes.values()].map((n) => ({
      id: n.id,
      char: n.char,
      terminal: n.terminal,
      children: [...n.children.values()].map((c) => c.id),
    }))
    return { kind: 'trie', nodes, root: this.rootNode.id, marks: this.marks.list(this.pending) }
  }

  get root(): NodeId {
    return this.rootNode.id
  }

  insert(word: string): void {
    let node = this.rootNode
    for (const ch of word) {
      let next = node.children.get(ch)
      if (!next) {
        next = this.make(ch)
        node.children.set(ch, next)
        this.emit('insert', [{ id: next.id, class: 'active' }], `add '${ch}'`)
      } else {
        this.emit('visit', [{ id: next.id, class: 'active' }], `walk '${ch}'`)
      }
      node = next
    }
    node.terminal = true
    this.emit('write', [{ id: node.id, class: 'result' }], `mark end of "${word}"`)
  }

  /**
   * The child of `id` on `ch`, or null when there is no such branch.
   *
   * The one call a lookup makes, and the reason this class has a node-level API at all: with only
   * `insert`/`search`/`startsWith`, an instrumented LeetCode 208 is a three-line delegation to the
   * library and the learner writes nothing. `VizTree` has had `left`/`right` plus a non-recording
   * `childrenOf` from the start; this is the same shape.
   *
   * The node walked onto keeps a *persistent* `path` mark, so the branch matched so far reads as a
   * whole rather than one node flashing at a time — which is what lets a viewer see that `search`
   * and `startsWith` traverse identically and disagree only on the last question. A failed step
   * marks the node the walk died at `excluded`, so the frame reporting a miss does not show a
   * picture identical to a hit.
   *
   * Starting again from the root clears the previous walk's `path`/`excluded` marks by itself. An
   * API that instead required every solution to remember `clearMarks()` first would be the same
   * footgun as marks that are never retired — a correct algorithm whose picture accumulates into
   * nonsense, with every test still green.
   */
  child(id: NodeId, ch: string): NodeId | null {
    this.retireWalk(id)
    const next = this.require(id).children.get(ch)
    if (!next) {
      this.marks.set(id, 'excluded', `no '${ch}' branch from here`)
      this.rec.record({ op: 'read', structure: this, label: `no '${ch}' branch here` })
      return null
    }
    this.marks.set(next.id, 'path')
    this.emit('visit', [{ id: next.id, class: 'active' }], `walk '${ch}'`)
    return next.id
  }

  /** Child without recording — the guard twin of `child`. */
  childOf(id: NodeId, ch: string): NodeId | null {
    return this.require(id).children.get(ch)?.id ?? null
  }

  /**
   * The child of `id` on `ch`, created when the branch is missing.
   *
   * Emits `insert` for a node that was created and `visit` for one that was reused, so the
   * shared-prefix property — the whole reason a trie exists — is readable straight off the op log.
   */
  addChild(id: NodeId, ch: string): NodeId {
    this.retireWalk(id)
    const node = this.require(id)
    const existing = node.children.get(ch)
    if (existing) {
      this.marks.set(existing.id, 'path')
      this.emit('visit', [{ id: existing.id, class: 'active' }], `'${ch}' is already here — reuse it`)
      return existing.id
    }
    const next = this.make(ch)
    node.children.set(ch, next)
    this.marks.set(next.id, 'path')
    this.emit('insert', [{ id: next.id, class: 'active' }], `add '${ch}'`)
    return next.id
  }

  /** Is this node the end of an inserted word? Records nothing — it is a guard. */
  isTerminal(id: NodeId): boolean {
    return this.require(id).terminal
  }

  /** Flag a node as the end of a word. */
  setTerminal(id: NodeId, word?: string): void {
    this.require(id).terminal = true
    this.emit(
      'write',
      [{ id, class: 'result' }],
      word === undefined ? 'end of word' : `mark end of "${word}"`,
    )
  }

  /** Walk `word`; returns the node reached, or null if the branch runs out. */
  walk(word: string): NodeId | null {
    let node: TrieInternal = this.rootNode
    for (const ch of word) {
      // `const next`, not `node = ...`. Overwriting `node` with undefined destroyed the identity of
      // the last good node, so the frame reporting a failed walk could not say where it fell off.
      const next = node.children.get(ch)
      if (!next) {
        this.marks.set(node.id, 'excluded', `no '${ch}' branch from here`)
        this.rec.record({ op: 'read', structure: this, label: `no branch for '${ch}'` })
        return null
      }
      node = next
      this.emit('visit', [{ id: node.id, class: 'path' }], `walk '${ch}'`)
    }
    return node.id
  }

  search(word: string): boolean {
    const id = this.walk(word)
    const found = id !== null && (this.nodes.get(id)?.terminal ?? false)
    // The answer frame highlights the node it is answering about. Recording it bare left the frame
    // a viewer stops on to read the verdict showing a completely unmarked trie; `VizMap.has` is the
    // in-repo precedent for `active` on a hit and `excluded` on a miss.
    this.emitAnswer(id, found, `search "${word}" -> ${found}`)
    return found
  }

  startsWith(prefix: string): boolean {
    const id = this.walk(prefix)
    const found = id !== null
    this.emitAnswer(id, found, `startsWith "${prefix}" -> ${found}`)
    return found
  }

  private emitAnswer(id: NodeId | null, found: boolean, label: string): void {
    const marks: NodeMark[] = id === null ? [] : [{ id, class: found ? 'match' : 'excluded' }]
    this.emit('read', marks, label)
  }

  /** A walk always restarts at the root, so that is where the previous one is retired. */
  private retireWalk(id: NodeId): void {
    if (id !== this.rootNode.id) return
    this.marks.clear('path')
    this.marks.clear('excluded')
  }

  private require(id: NodeId): TrieInternal {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`Unknown trie node "${id}" — ids come from root/child/addChild`)
    return node
  }

  /** Words under a node, in lexicographic order. Records nothing. */
  wordsUnder(id: NodeId, limit = Number.POSITIVE_INFINITY): string[] {
    const start = this.nodes.get(id)
    if (!start) return []
    const out: string[] = []
    const walk = (node: TrieInternal, acc: string): void => {
      if (out.length >= limit) return
      if (node.terminal) out.push(acc)
      for (const ch of [...node.children.keys()].sort()) {
        const child = node.children.get(ch)
        if (child) walk(child, acc + ch)
      }
    }
    walk(start, '')
    return out
  }

  mark(id: NodeId, cls: MarkClass, note?: string): void {
    this.marks.set(id, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${id} as ${cls}` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: 'clear marks' })
  }

  private emit(op: 'insert' | 'visit' | 'write' | 'read', marks: NodeMark[], label: string): void {
    this.pending = marks
    this.rec.record({ op, structure: this, label })
    this.pending = undefined
  }
}
