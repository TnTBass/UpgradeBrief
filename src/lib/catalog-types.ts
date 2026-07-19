export const productIds = [
  'vbr',
  'enterprise-manager',
  'veeam-one',
  'vro',
  'vspc',
] as const

export type ProductId = (typeof productIds)[number]
export type CoverageState = 'complete' | 'partial' | 'unavailable'
export type Urgency = 'critical' | 'high' | 'standard'

export interface Source {
  id: string
  title: string
  url: string
  checkedAt: string
}

export interface Product {
  id: ProductId
  name: string
  aliases: string[]
  recommendedReleaseId: string
  coverage: {
    security: CoverageState
    lifecycle: CoverageState
    upgradePath: CoverageState
  }
}

export interface Release {
  id: string
  productId: ProductId
  name: string
  aliases: string[]
  sourceIds: string[]
}

export interface LifecycleNotice {
  productId: ProductId
  releaseId?: string
  state: 'supported' | 'end-of-fix' | 'end-of-support' | 'check-source'
  summary: string
  sourceIds: string[]
}

export interface UpgradePath {
  id: string
  productId: ProductId
  fromReleaseId: string
  toReleaseId: string
  hopReleaseIds: string[]
  notes: string[]
  sourceIds: string[]
}

export interface SecurityFinding {
  id: string
  productId: ProductId
  title: string
  cves: string[]
  affectedReleaseIds: string[]
  fixedReleaseId: string
  cvssScore?: number
  isCisaKev?: boolean
  veeamConfirmedActiveExploitation?: boolean
  conditions: string[]
  sourceIds: string[]
}

export interface Catalog {
  schemaVersion: 1
  generatedAt: string
  sources: Source[]
  products: Product[]
  releases: Release[]
  lifecycleNotices: LifecycleNotice[]
  upgradePaths: UpgradePath[]
  securityFindings: SecurityFinding[]
}
