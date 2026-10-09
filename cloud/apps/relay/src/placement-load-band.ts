// Spreads placement over cells near the minimum load, so a freshly rolled
// (empty) cell does not take a whole drain and serialize every follow-up on
// its one relay_cells row. It only orders candidates: a candidate is never
// refused, and the pool's least-loaded cell is the fallback.

// Cells within this share of capacity of the least-loaded one are equals.
export const PLACEMENT_LOAD_BAND = 0.05
export const PLACEMENT_INTAKE_WINDOW_MS = 10_000
// A cell over this share of its pool's recent placements yields to the rest.
export const PLACEMENT_INTAKE_SHARE = 0.4
// Below this many recent picks a cell is never skipped, so quiet traffic
// still goes to the least-loaded cell.
export const PLACEMENT_INTAKE_FLOOR = 4

export type LoadBandCandidate = { cellId: string; loadRatio: number }

export class PlacementLoadBand {
  // Director-instance-local and in memory: it shapes order, never correctness.
  private readonly intake = new Map<string, number[]>()

  constructor(private readonly random: () => number = Math.random) {}

  // `sorted` is ascending by load ratio. Records the pick as intake; a pick
  // whose transaction retries still counts, which only spreads harder.
  pick<T extends LoadBandCandidate>(sorted: readonly T[], now: number): T | undefined {
    const least = sorted[0]
    if (!least) return undefined
    const recent = new Map(
      sorted.map((candidate) => [candidate.cellId, this.recentIntake(candidate.cellId, now)])
    )
    let poolIntake = 0
    for (const count of recent.values()) poolIntake += count
    const budget = Math.max(PLACEMENT_INTAKE_FLOOR, PLACEMENT_INTAKE_SHARE * poolIntake)
    const withinBudget = sorted.filter((candidate) => (recent.get(candidate.cellId) ?? 0) < budget)
    const pool = withinBudget.length > 0 ? withinBudget : [least]
    const ceiling = pool[0]!.loadRatio + PLACEMENT_LOAD_BAND
    const band = pool.filter((candidate) => candidate.loadRatio <= ceiling)
    const picked = band[Math.min(band.length - 1, Math.floor(this.random() * band.length))]!
    this.record(picked.cellId, now)
    return picked
  }

  private recentIntake(cellId: string, now: number): number {
    const times = this.intake.get(cellId)
    if (!times) return 0
    const cutoff = now - PLACEMENT_INTAKE_WINDOW_MS
    let expired = 0
    while (expired < times.length && times[expired]! <= cutoff) expired += 1
    if (expired > 0) times.splice(0, expired)
    if (times.length === 0) this.intake.delete(cellId)
    return times.length
  }

  private record(cellId: string, now: number): void {
    const times = this.intake.get(cellId)
    if (times) times.push(now)
    else this.intake.set(cellId, [now])
  }
}
