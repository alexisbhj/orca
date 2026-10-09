/** The named fields a stored record holds; an undefined value is a missing field on disk (JSON). */
export function pickStoredFields<T extends object, K extends keyof T>(
  record: T,
  keys: readonly K[]
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (record[key] !== undefined) {
      picked[key] = record[key]
    }
  }
  return picked
}

export function omitStoredFields<T extends object, K extends keyof T>(
  record: T,
  keys: readonly K[]
): Omit<T, K> {
  const omitted = { ...record }
  for (const key of keys) {
    delete omitted[key]
  }
  return omitted
}

export function isEmptyRecord(record: object | undefined): boolean {
  return !record || Object.keys(record).length === 0
}
