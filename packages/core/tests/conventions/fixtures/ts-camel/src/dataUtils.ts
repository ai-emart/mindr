export function formatDate(dateInput: Date) {
  return dateInput.toISOString()
}

export function parseJson(rawString: string) {
  return JSON.parse(rawString)
}

export function mergeObjects(baseObj: object, overrides: object) {
  return Object.assign({}, baseObj, overrides)
}

export function filterEmpty(inputArray: unknown[]) {
  return inputArray.filter(Boolean)
}

export function sortByKey(items: Record<string, unknown>[], keyName: string) {
  return [...items].sort((a, b) =>
    String(a[keyName]) < String(b[keyName]) ? -1 : 1,
  )
}
