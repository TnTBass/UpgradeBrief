export function formatLifecycleHeading(state?: string): string {
  if (!state) return 'Source check required'
  return `${state[0].toUpperCase()}${state.slice(1).replaceAll('-', ' ')}`
}

export function formatExecutiveRoute(releases: string[]): string {
  return releases.join(' -> ')
}
