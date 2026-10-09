import { describe, expect, it } from 'vitest'
import {
  PLACEMENT_INTAKE_FLOOR,
  PLACEMENT_INTAKE_SHARE,
  PLACEMENT_INTAKE_WINDOW_MS,
  PlacementLoadBand
} from './placement-load-band.js'
import { RelayAssignmentStore } from './assignment-store.js'
import { openInMemoryRelayDatabase } from './database.js'

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

type SimulatedCell = { cellId: string; reserved: number; capacity: number }

function simulate(
  band: PlacementLoadBand,
  cells: SimulatedCell[],
  picks: number,
  now: () => number
) {
  const counts = new Map(cells.map((cell) => [cell.cellId, 0]))
  for (let index = 0; index < picks; index += 1) {
    const ranked = cells
      .filter((cell) => cell.reserved < cell.capacity)
      .map((cell) => ({ cellId: cell.cellId, loadRatio: cell.reserved / cell.capacity, cell }))
      .sort(
        (left, right) =>
          left.loadRatio - right.loadRatio || left.cellId.localeCompare(right.cellId)
      )
    const picked = band.pick(ranked, now())
    if (!picked) throw new Error('no candidate')
    picked.cell.reserved += 1
    counts.set(picked.cellId, (counts.get(picked.cellId) ?? 0) + 1)
  }
  return counts
}

describe('PlacementLoadBand', () => {
  it('spreads a drain over an empty cell and four fuller cells within one window', () => {
    const cells: SimulatedCell[] = [
      { cellId: 'cell-empty', reserved: 0, capacity: 6000 },
      ...['cell-b', 'cell-c', 'cell-d', 'cell-e'].map((cellId) => ({
        cellId,
        reserved: 2100,
        capacity: 6000
      }))
    ]
    const counts = simulate(new PlacementLoadBand(seededRandom(7)), cells, 2000, () => 1_000)

    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(2000)
    expect(counts.get('cell-empty')).toBeLessThanOrEqual(PLACEMENT_INTAKE_SHARE * 2000 + 1)
    for (const cellId of ['cell-b', 'cell-c', 'cell-d', 'cell-e']) {
      expect(counts.get(cellId)).toBeGreaterThan(200)
    }
    for (const cell of cells) expect(cell.reserved).toBeLessThanOrEqual(cell.capacity)
  })

  it('never places past capacity while the fuller cells fill', () => {
    const cells: SimulatedCell[] = [
      { cellId: 'cell-empty', reserved: 0, capacity: 100 },
      ...['cell-b', 'cell-c'].map((cellId) => ({ cellId, reserved: 90, capacity: 100 }))
    ]
    const counts = simulate(new PlacementLoadBand(seededRandom(11)), cells, 120, () => 1_000)

    expect(cells.map((cell) => cell.reserved)).toEqual([100, 100, 100])
    expect(counts.get('cell-empty')).toBe(100)
  })

  it('falls back to the least-loaded cell when every candidate is over budget', () => {
    const band = new PlacementLoadBand(seededRandom(3))
    const only = [{ cellId: 'cell-a', loadRatio: 0.5 }]
    for (let index = 0; index < 50; index += 1) {
      expect(band.pick(only, 1_000)?.cellId).toBe('cell-a')
    }
    expect(band.pick([], 1_000)).toBeUndefined()
  })

  it('keeps quiet placement on the least-loaded cell outside the band', () => {
    let now = 0
    const band = new PlacementLoadBand(seededRandom(5))
    const ranked = [
      { cellId: 'cell-a', loadRatio: 0.1 },
      { cellId: 'cell-b', loadRatio: 0.3 }
    ]
    for (let index = 0; index < 20; index += 1) {
      now += PLACEMENT_INTAKE_WINDOW_MS / PLACEMENT_INTAKE_FLOOR
      expect(band.pick(ranked, now)?.cellId).toBe('cell-a')
    }
  })

  it('picks at random among cells inside the band', () => {
    const band = new PlacementLoadBand(seededRandom(9))
    const ranked = [
      { cellId: 'cell-a', loadRatio: 0.3 },
      { cellId: 'cell-b', loadRatio: 0.32 },
      { cellId: 'cell-c', loadRatio: 0.4 }
    ]
    const picked = new Set<string>()
    let now = 0
    for (let index = 0; index < 40; index += 1) {
      now += PLACEMENT_INTAKE_WINDOW_MS
      picked.add(band.pick(ranked, now)?.cellId ?? '')
    }
    expect([...picked].sort()).toEqual(['cell-a', 'cell-b'])
  })
})

describe('leastLoadedCell with the load band', () => {
  async function setupRegions() {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayAssignmentStore(database, () => 1_000, {
      placementLoadBand: new PlacementLoadBand(seededRandom(13))
    })
    const asia = ['asia-a', 'asia-b', 'asia-c', 'asia-d', 'asia-e']
    await store.reconcileCells([
      ...asia.map((id) => ({
        id,
        url: `https://${id}.example.com`,
        capacityRequests: 100,
        region: 'asia-east2' as const
      })),
      {
        id: 'us-a',
        url: 'https://us-a.example.com',
        capacityRequests: 1000,
        region: 'us-central1' as const
      }
    ])
    await database.query(
      `UPDATE relay_cells SET observed_requests = 35 WHERE cell_id IN (?, ?, ?, ?)`,
      asia.slice(1)
    )
    return { database, store }
  }

  async function placements(store: RelayAssignmentStore, count: number) {
    const counts = new Map<string, number>()
    for (let index = 0; index < count; index += 1) {
      const assignment = await store.assign(
        { userId: `user-${index}`, relayHostId: `host${String(index).padStart(12, '0')}` },
        'asia-east2'
      )
      counts.set(assignment.cellId, (counts.get(assignment.cellId) ?? 0) + 1)
    }
    return counts
  }

  it('spreads within the preferred region and keeps an empty US cell out', async () => {
    const { store } = await setupRegions()
    const counts = await placements(store, 200)

    expect(counts.get('us-a')).toBeUndefined()
    expect(counts.get('asia-a')).toBeLessThanOrEqual(PLACEMENT_INTAKE_SHARE * 200 + 1)
    const used = [...counts.values()].filter((count) => count >= 20)
    expect(used.length).toBeGreaterThanOrEqual(3)
  })

  it('fills the preferred region to its hard cap before spilling, never past it', async () => {
    const { database, store } = await setupRegions()
    const counts = await placements(store, 520)
    const rows = await database.query(
      `SELECT reserved_requests, capacity_requests FROM relay_cells`
    )

    // The hard cap is reserved < capacity: five Asia cells hold 500, the rest spill to the US.
    expect(counts.get('us-a')).toBe(20)
    for (const row of rows) {
      expect(Number(row.reserved_requests)).toBeLessThanOrEqual(Number(row.capacity_requests))
    }
  })
})
