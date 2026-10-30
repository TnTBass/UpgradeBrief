import { REVIEWED_SECURITY_CLASSIFICATIONS } from './reviewed-security-advisories.mjs'
export const pinnedSecurityArticles = [
  { id: 'kb3103', type: 'security', url: '/kb3103', seoTitle: 'List of Security Fixes and Improvements in Veeam Backup & Replication', product: [{ title: 'Veeam Backup & Replication' }] },
  { id: 'kb4858', type: 'security', url: '/kb4858', seoTitle: 'List of Security Fixes and Improvements in Veeam ONE', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb4857', type: 'security', url: '/kb4857', seoTitle: 'List of Security Fixes and Improvements in Veeam Recovery Orchestrator', product: [{ title: 'Veeam Recovery Orchestrator' }] },
  { id: 'kb4856', type: 'security', url: '/kb4856', seoTitle: 'List of Security Fixes and Improvements in Veeam Service Provider Console', product: [{ title: 'Veeam Service Provider Console' }] },
]
export const securityClassificationOverrides = {
  ...REVIEWED_SECURITY_CLASSIFICATIONS,
  kb3144: { classification: 'dedicated', productIds: ['veeam-one'] },
  kb3221: { classification: 'dedicated', productIds: ['veeam-one'] },
  kb4575: { classification: 'dedicated', productIds: ['vspc'] },
  kb4679: { classification: 'dedicated', productIds: ['vspc'] },
  kb4858: { classification: 'inventory', productIds: ['veeam-one'] },
  kb4856: { classification: 'inventory', productIds: ['vspc'] },
  kb4962: { classification: 'inventory', productIds: ['vb365'] },
  kb4961: { classification: 'out-of-scope' },
  kb4582: { classification: 'out-of-scope' },
  kb4374: { classification: 'out-of-scope' },
  kb4338: { classification: 'out-of-scope' },
  kb4289: { classification: 'out-of-scope' },
  kb4261: { classification: 'out-of-scope' },
  kb3108: { classification: 'out-of-scope' },
  kb3109: { classification: 'out-of-scope' },
}

