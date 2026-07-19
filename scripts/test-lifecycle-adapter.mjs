import { mergeLifecyclePolicies, parseLifecyclePolicies } from './lib/lifecycle.mjs'

const fixture = `
<tr><td class="veeam-table__cell--title">Veeam ONE</td><td>13</td><td>September 2025</td><td>November 2028</td><td>November 2028</td></tr>
<tr><td> </td><td>12</td><td>February 2023</td><td>September 2025</td><td>February 2027</td></tr>
<tr><td> </td><td>11</td><td>February 2021</td><td>February 2023</td><td>February 2024</td></tr>`
const policies = parseLifecyclePolicies(fixture)
if (policies.length !== 3 || policies[2].productId !== 'veeam-one') throw new Error('Lifecycle table was not parsed correctly.')

const catalog = {
  products: [{ id: 'veeam-one', name: 'Veeam ONE' }],
  releases: [{ id: 'one-6', productId: 'veeam-one', name: '6.5 P1', aliases: ['6.5.0.686'] }, { id: 'one-12', productId: 'veeam-one', name: '12', aliases: ['12.0.0.1'] }],
  lifecycleNotices: [],
}
const merged = mergeLifecyclePolicies(catalog, policies, new Date('2026-07-19T00:00:00Z'))
if (merged.catalog.lifecycleNotices.find((notice) => notice.releaseId === 'one-6')?.state !== 'end-of-support') throw new Error('Pre-table legacy release was not marked end of support.')
if (merged.catalog.lifecycleNotices.find((notice) => notice.releaseId === 'one-12')?.state !== 'end-of-fix') throw new Error('Published lifecycle row was not applied.')
console.log('Lifecycle adapter fixture test passed.')
