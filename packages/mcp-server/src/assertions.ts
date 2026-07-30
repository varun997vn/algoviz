import { TraceReader, type MarkClass, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Mechanical trace assertions.
 *
 * This is what turns "does the animation look right?" from prose into something an agent can
 * check. Passing unit tests say nothing about whether the visualization faithfully represents
 * the algorithm; without assertions like these, a review of a trace degenerates into eyeballing
 * a description and producing false confidence.
 */

export type Assertion =
  | { kind: 'final-marks'; structure: string; class: MarkClass; count: number }
  | { kind: 'never-marked-at-end'; structure: string; class: MarkClass }
  | { kind: 'cursor-in-range'; structure: string; cursor: string; min: number; max: number }
  | { kind: 'cursor-monotonic'; structure: string; cursor: string; direction: 'up' | 'down' }
  /** 2-D equivalent of `cursor-in-range`, for a cursor on a matrix. */
  | {
      kind: 'cursor-cell-in-range'
      structure: string
      cursor: string
      minRow: number
      maxRow: number
      minCol: number
      maxCol: number
    }
  | { kind: 'frame-count-lte'; max: number }
  | { kind: 'frame-count-gte'; min: number }
  | { kind: 'has-steps'; min: number }
  | { kind: 'final-equals'; value: unknown }
  | { kind: 'edge-state-count'; structure: string; state: string; count: number }
  | { kind: 'every-node-visited'; structure: string }

export interface AssertionFailure {
  assertion: Assertion
  reason: string
  frameIndex?: number
}

export interface AssertionReport {
  passed: boolean
  checked: number
  failures: AssertionFailure[]
}

function structureId(trace: Trace, nameOrId: string): string | undefined {
  return trace.structures.find((s) => s.id === nameOrId || s.name === nameOrId)?.id
}

function finalSnapshot(trace: Trace, nameOrId: string): StructureSnapshot | undefined {
  const id = structureId(trace, nameOrId)
  if (!id) return undefined
  return new TraceReader(trace).structureAt(id, trace.frames.length - 1)
}

function marksOf(snapshot: StructureSnapshot): { class: MarkClass }[] {
  return 'marks' in snapshot ? (snapshot.marks as { class: MarkClass }[]) : []
}

interface AnyCursor {
  name: string
  index?: number
  row?: number
  col?: number
}

/**
 * Every appearance of a named cursor on a structure, with the frame it appeared on.
 *
 * Returning the appearances rather than checking inline is what lets each cursor assertion
 * distinguish "the cursor was in range" from "the cursor was never there" — a distinction the
 * first version of this file silently collapsed, with the result that `cursor-in-range` passed
 * for a cursor that did not exist and for every 2-D cursor (which carries row/col, not index).
 * An assertion that cannot fail is worse than no assertion: it manufactures confidence.
 */
function cursorAppearances(
  trace: Trace,
  structure: string,
  cursorName: string,
): { found: boolean; structureExists: boolean; at: { frame: number; cursor: AnyCursor }[] } {
  const id = structureId(trace, structure)
  if (!id) return { found: false, structureExists: false, at: [] }

  const reader = new TraceReader(trace)
  const at: { frame: number; cursor: AnyCursor }[] = []
  for (let i = 0; i < reader.frameCount; i += 1) {
    const snapshot = reader.structureAt(id, i)
    if (!snapshot || !('cursors' in snapshot)) continue
    const cursor = (snapshot.cursors as AnyCursor[]).find((c) => c.name === cursorName)
    if (cursor) at.push({ frame: i, cursor })
  }
  return { found: at.length > 0, structureExists: true, at }
}

export function checkAssertions(trace: Trace, assertions: readonly Assertion[]): AssertionReport {
  const failures: AssertionFailure[] = []
  const reader = new TraceReader(trace)

  for (const assertion of assertions) {
    const fail = (reason: string, frameIndex?: number): void => {
      failures.push({ assertion, reason, ...(frameIndex !== undefined ? { frameIndex } : {}) })
    }

    switch (assertion.kind) {
      case 'final-marks': {
        const snapshot = finalSnapshot(trace, assertion.structure)
        if (!snapshot) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        const actual = marksOf(snapshot).filter((m) => m.class === assertion.class).length
        if (actual !== assertion.count) {
          fail(`expected ${assertion.count} "${assertion.class}" marks at the end, found ${actual}`)
        }
        break
      }

      case 'never-marked-at-end': {
        const snapshot = finalSnapshot(trace, assertion.structure)
        if (!snapshot) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        const leftover = marksOf(snapshot).filter((m) => m.class === assertion.class).length
        if (leftover > 0) {
          fail(
            `${leftover} "${assertion.class}" marks survived to the final frame — transient state ` +
              'that should have been cleared (a path that never unwound, most likely)',
          )
        }
        break
      }

      case 'cursor-in-range': {
        const { found, structureExists, at } = cursorAppearances(
          trace,
          assertion.structure,
          assertion.cursor,
        )
        if (!structureExists) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        if (!found) {
          // The failure mode this catches: viz.cursor silently attaching a cursor to the wrong
          // structure (or to none), which renders as a missing caret rather than an error.
          fail(
            `cursor "${assertion.cursor}" never appears on "${assertion.structure}" — it is ` +
              'attached elsewhere or not attached at all, so this assertion had nothing to check',
          )
          break
        }
        const twoD = at.find(({ cursor }) => cursor.index === undefined && cursor.row !== undefined)
        if (twoD) {
          fail(
            `cursor "${assertion.cursor}" on "${assertion.structure}" is a 2-D cursor ` +
              '(row/col) — use cursor-cell-in-range instead',
            twoD.frame,
          )
          break
        }
        for (const { frame, cursor } of at) {
          if (cursor.index === undefined) continue
          if (cursor.index < assertion.min || cursor.index > assertion.max) {
            fail(
              `cursor "${assertion.cursor}" reached ${cursor.index}, outside ${assertion.min}..${assertion.max}`,
              frame,
            )
            break
          }
        }
        break
      }

      case 'cursor-cell-in-range': {
        const { found, structureExists, at } = cursorAppearances(
          trace,
          assertion.structure,
          assertion.cursor,
        )
        if (!structureExists) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        if (!found) {
          fail(`cursor "${assertion.cursor}" never appears on "${assertion.structure}"`)
          break
        }
        for (const { frame, cursor } of at) {
          const { row, col } = cursor
          if (row === undefined || col === undefined) {
            fail(
              `cursor "${assertion.cursor}" on "${assertion.structure}" is not a 2-D cursor — ` +
                'use cursor-in-range instead',
              frame,
            )
            break
          }
          if (row < assertion.minRow || row > assertion.maxRow || col < assertion.minCol || col > assertion.maxCol) {
            fail(
              `cursor "${assertion.cursor}" reached (${row},${col}), outside ` +
                `rows ${assertion.minRow}..${assertion.maxRow} cols ${assertion.minCol}..${assertion.maxCol}`,
              frame,
            )
            break
          }
        }
        break
      }

      case 'cursor-monotonic': {
        const { found, structureExists, at } = cursorAppearances(
          trace,
          assertion.structure,
          assertion.cursor,
        )
        if (!structureExists) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        if (!found) {
          fail(
            `cursor "${assertion.cursor}" never appears on "${assertion.structure}" — it is ` +
              'attached elsewhere or not attached at all, so this assertion had nothing to check',
          )
          break
        }
        if (at.every(({ cursor }) => cursor.index === undefined)) {
          fail(
            `cursor "${assertion.cursor}" on "${assertion.structure}" has no linear index ` +
              '(2-D cursors are not monotonic in one dimension)',
          )
          break
        }
        let previous: number | undefined
        for (const { frame, cursor } of at) {
          if (cursor.index === undefined) continue
          if (previous !== undefined) {
            const moved = cursor.index - previous
            if ((assertion.direction === 'up' && moved < 0) || (assertion.direction === 'down' && moved > 0)) {
              fail(
                `cursor "${assertion.cursor}" moved ${moved > 0 ? 'forwards' : 'backwards'} ` +
                  `(${previous} -> ${cursor.index}) but was asserted monotonically ${assertion.direction}`,
                frame,
              )
              break
            }
          }
          previous = cursor.index
        }
        break
      }

      case 'frame-count-lte':
        if (trace.frames.length > assertion.max) {
          fail(`trace has ${trace.frames.length} frames, more than ${assertion.max}`)
        }
        break

      case 'frame-count-gte':
        if (trace.frames.length < assertion.min) {
          fail(`trace has only ${trace.frames.length} frames, fewer than ${assertion.min}`)
        }
        break

      case 'has-steps': {
        const steps = reader.stepFrames().length
        if (steps < assertion.min) {
          fail(
            `only ${steps} viz.step() narrations — the animation will be hard to follow ` +
              `(wanted at least ${assertion.min})`,
          )
        }
        break
      }

      case 'final-equals': {
        const returned = trace.result?.returned
        if (JSON.stringify(returned) !== JSON.stringify(assertion.value)) {
          fail(`returned ${JSON.stringify(returned)}, expected ${JSON.stringify(assertion.value)}`)
        }
        break
      }

      case 'edge-state-count': {
        const snapshot = finalSnapshot(trace, assertion.structure)
        if (!snapshot || !('edgeMarks' in snapshot)) {
          fail(`no structure named "${assertion.structure}" with edges`)
          break
        }
        const actual = snapshot.edgeMarks.filter((e) => e.class === assertion.state).length
        if (actual !== assertion.count) {
          fail(`expected ${assertion.count} edges in state "${assertion.state}", found ${actual}`)
        }
        break
      }

      case 'every-node-visited': {
        const snapshot = finalSnapshot(trace, assertion.structure)
        if (!snapshot) {
          fail(`no structure named "${assertion.structure}"`)
          break
        }
        if (!('nodes' in snapshot)) {
          fail(`"${assertion.structure}" has no nodes`)
          break
        }
        const marked = new Set(
          (snapshot.marks as { id: string; class: MarkClass }[])
            .filter((m) => m.class === 'visited' || m.class === 'result')
            .map((m) => m.id),
        )
        const missing = snapshot.nodes.filter((n) => !marked.has(n.id))
        if (missing.length > 0) {
          fail(`${missing.length} node(s) never marked visited: ${missing.map((n) => n.id).join(', ')}`)
        }
        break
      }
    }
  }

  return { passed: failures.length === 0, checked: assertions.length, failures }
}

export function renderReport(report: AssertionReport): string {
  if (report.passed) return `All ${report.checked} assertion(s) passed.`
  return [
    `${report.failures.length} of ${report.checked} assertion(s) FAILED:`,
    ...report.failures.map(
      (f) =>
        `  - ${f.assertion.kind}: ${f.reason}${f.frameIndex !== undefined ? ` (frame ${f.frameIndex})` : ''}`,
    ),
  ].join('\n')
}
