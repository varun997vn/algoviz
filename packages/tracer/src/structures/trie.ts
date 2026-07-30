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

  /** Walk `word`; returns the node reached, or null if the branch runs out. */
  walk(word: string): NodeId | null {
    let node: TrieInternal | undefined = this.rootNode
    for (const ch of word) {
      node = node.children.get(ch)
      if (!node) {
        this.rec.record({ op: 'read', structure: this, label: `no branch for '${ch}'` })
        return null
      }
      this.emit('visit', [{ id: node.id, class: 'path' }], `walk '${ch}'`)
    }
    return node.id
  }

  search(word: string): boolean {
    const id = this.walk(word)
    const found = id !== null && (this.nodes.get(id)?.terminal ?? false)
    this.rec.record({ op: 'read', structure: this, label: `search "${word}" -> ${found}` })
    return found
  }

  startsWith(prefix: string): boolean {
    const found = this.walk(prefix) !== null
    this.rec.record({ op: 'read', structure: this, label: `startsWith "${prefix}" -> ${found}` })
    return found
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

  private emit(op: 'insert' | 'visit' | 'write', marks: NodeMark[], label: string): void {
    this.pending = marks
    this.rec.record({ op, structure: this, label })
    this.pending = undefined
  }
}
