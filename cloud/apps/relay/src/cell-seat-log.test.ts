import { describe, expect, it } from 'vitest'
import { CELL_SEAT_FEED_PAGE_MAX, CellSeatLog, parseCellSeatCursor } from './cell-seat-log.js'

const seat = {
  userId: 'user-1',
  relayHostId: 'abcdefghijklmnop',
  epoch: 3,
  generation: 1,
  state: 'active' as const,
  joinedAt: 10
}

function append(log: CellSeatLog, count: number): void {
  for (let index = 0; index < count; index += 1) {
    log.append({
      kind: 'join',
      userId: `user-${index}`,
      relayHostId: 'abcdefghijklmnop',
      epoch: 1,
      generation: 1,
      at: index
    })
  }
}

describe('cell seat log', () => {
  it('answers a missing cursor with the live seats and the head as the next cursor', () => {
    const log = new CellSeatLog(8)
    append(log, 3)
    expect(log.read(null, () => [seat])).toEqual({ seq: 3, full: [seat] })
  })

  it('returns only the changes after the cursor', () => {
    const log = new CellSeatLog(8)
    append(log, 5)
    const page = log.read(3, () => [])
    expect(page).toMatchObject({ seq: 5, more: false })
    expect('changes' in page && page.changes.map((change) => change.seq)).toEqual([4, 5])
    expect(log.read(5, () => [])).toEqual({ seq: 5, changes: [], more: false })
  })

  it('resyncs with a full snapshot once the cursor has fallen out of the ring', () => {
    const log = new CellSeatLog(4)
    append(log, 10)
    // Seqs 7..10 remain, so a cursor at 6 still continues and 5 does not.
    expect(log.read(6, () => [])).toMatchObject({ seq: 10, more: false })
    expect(log.read(5, () => [seat])).toEqual({ seq: 10, full: [seat] })
  })

  it('resyncs a cursor ahead of the head instead of skipping changes', () => {
    const log = new CellSeatLog(4)
    append(log, 2)
    expect(log.read(9, () => [])).toEqual({ seq: 2, full: [] })
  })

  it('pages a long backlog and resumes from the returned cursor', () => {
    const log = new CellSeatLog(CELL_SEAT_FEED_PAGE_MAX * 2)
    append(log, CELL_SEAT_FEED_PAGE_MAX + 5)
    const first = log.read(0, () => [])
    expect(first).toMatchObject({ seq: CELL_SEAT_FEED_PAGE_MAX, more: true })
    expect('changes' in first && first.changes).toHaveLength(CELL_SEAT_FEED_PAGE_MAX)
    const second = log.read(first.seq, () => [])
    expect(second).toMatchObject({ seq: CELL_SEAT_FEED_PAGE_MAX + 5, more: false })
    expect('changes' in second && second.changes).toHaveLength(5)
  })
})

describe('cell seat cursor', () => {
  it('reads an incarnation and a sequence, and refuses anything else', () => {
    expect(parseCellSeatCursor(undefined)).toBeNull()
    expect(parseCellSeatCursor('')).toBeNull()
    expect(parseCellSeatCursor('11111111-1111-4111-8111-111111111111:42')).toEqual({
      incarnation: '11111111-1111-4111-8111-111111111111',
      seq: 42
    })
    expect(parseCellSeatCursor('incarnation')).toBe('invalid')
    expect(parseCellSeatCursor('a:-1')).toBe('invalid')
    expect(parseCellSeatCursor('a b:1')).toBe('invalid')
  })
})
