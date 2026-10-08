import type { ProductId } from './catalog-types'

export function selectionUrl(href: string, product: ProductId, version: string, view: 'results' | 'journey'): string {
  const url = new URL(href)
  url.searchParams.set('product', product)
  if (version.trim()) url.searchParams.set('version', version)
  else url.searchParams.delete('version')
  if (view === 'journey') url.searchParams.set('view', 'journey')
  else url.searchParams.delete('view')
  return `${url.pathname}?${url.searchParams}${url.hash}`
}
