import snapshot from './catalog.snapshot.json'
import type { Catalog } from '../lib/catalog-types'

export const catalog = snapshot as unknown as Catalog
