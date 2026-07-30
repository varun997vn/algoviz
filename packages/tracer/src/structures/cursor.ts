import type { Recorder } from '../recorder.js'
import type { Cursor, MarkClass, StructureId } from '../types.js'

/**
 * A named index into a linear structure.
 *
 * Cursors are the difference between "an array with a highlighted cell" and a readable
 * two-pointer animation: `left` and `right` render as labelled carets that move.
 * They are owned by the Viz facade (not a single structure) so one cursor can be attached
 * to whichever array/string it indexes.
 */
export class VizCursor {
  #index: number

  constructor(
    private readonly rec: Recorder,
    readonly name: string,
    start: number,
    readonly attachedTo: StructureId | undefined,
    readonly cls: MarkClass = 'active',
  ) {
    this.#index = start
  }

  get value(): number {
    return this.#index
  }

  set value(next: number) {
    this.move(next)
  }

  move(next: number): number {
    this.#index = next
    this.rec.recordCursorMove(this, `${this.name} -> ${next}`)
    return next
  }

  inc(by = 1): number {
    return this.move(this.#index + by)
  }

  dec(by = 1): number {
    return this.move(this.#index - by)
  }

  toSnapshot(): Cursor {
    return { name: this.name, index: this.#index, class: this.cls }
  }
}
