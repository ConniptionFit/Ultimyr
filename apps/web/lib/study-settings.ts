/** Options for a Choice, plus the saved value when it is not one of the presets (set through the API or MCP). */
export function withCurrent<T extends number>(presets: Array<[T, string]>, current: T, label: (v: T) => string): Array<[T, string]> {
  return presets.some(([v]) => v === current) ? presets : [...presets, [current, label(current)] as [T, string]].sort((a, b) => a[0] - b[0]);
}
