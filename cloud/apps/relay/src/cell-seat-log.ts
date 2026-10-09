// Seat changes on this cell, read by directors through `GET /v1/admin/cell-seats`.
// Wire contract (v1); readers must ignore unknown fields:
//   since=<incarnation>:<seq> returns `changes` after seq, or `full` when the cursor is
//   absent, from another incarnation, or older than the ring. `seq` in the reply is the
//   cursor for the next poll; `more` says a page was cut at CELL_SEAT_FEED_PAGE_MAX.
//   Apply a change only when its generation is >= the seat's: a superseded generation's
//   socket can close after its successor joined.

export type CellSeatState = 'active' | 'drain-only'

export type CellSeatChange = {
  seq: number
  kind: 'join' | 'leave' | 'drain-only'
  userId: string
  relayHostId: string
  epoch: number
  generation: number
  // Only on join: a rebind under a regional drain joins already drain-only.
  state?: CellSeatState
  // Only on leave.
  closeCode?: number
  at: number
}

export type CellSeat = {
  userId: string
  relayHostId: string
  epoch: number
  generation: number
  state: CellSeatState
  joinedAt: number
}

export type CellSeatPage =
  | { seq: number; changes: CellSeatChange[]; more: boolean }
  | { seq: number; full: CellSeat[] }

// ~10 minutes of a full-cell drain's joins and leaves (inferred), at ~130 B each.
export const CELL_SEAT_LOG_CAPACITY = 20_000
export const CELL_SEAT_FEED_PAGE_MAX = 2_000

export class CellSeatLog {
  private readonly ring: (CellSeatChange | undefined)[]
  private headSeq = 0

  constructor(private readonly capacity = CELL_SEAT_LOG_CAPACITY) {
    this.ring = new Array<CellSeatChange | undefined>(capacity)
  }

  append(change: Omit<CellSeatChange, 'seq'>): void {
    this.headSeq += 1
    this.ring[this.headSeq % this.capacity] = { seq: this.headSeq, ...change }
  }

  // `sinceSeq` null means the caller has no cursor for this incarnation.
  read(sinceSeq: number | null, seats: () => CellSeat[]): CellSeatPage {
    const oldestSeq = Math.max(1, this.headSeq - this.capacity + 1)
    if (sinceSeq === null || sinceSeq > this.headSeq || sinceSeq < oldestSeq - 1) {
      return { seq: this.headSeq, full: seats() }
    }
    const lastSeq = Math.min(this.headSeq, sinceSeq + CELL_SEAT_FEED_PAGE_MAX)
    const changes: CellSeatChange[] = []
    for (let seq = sinceSeq + 1; seq <= lastSeq; seq += 1) {
      changes.push(this.ring[seq % this.capacity]!)
    }
    return { seq: lastSeq, changes, more: lastSeq < this.headSeq }
  }
}

// Malformed cursors are a caller bug, so they are refused rather than resynced.
export function parseCellSeatCursor(
  value: string | undefined
): { incarnation: string; seq: number } | null | 'invalid' {
  if (value === undefined || value === '') return null
  const match = /^([A-Za-z0-9-]{1,64}):(\d{1,15})$/.exec(value)
  if (!match) return 'invalid'
  return { incarnation: match[1]!, seq: Number(match[2]) }
}
