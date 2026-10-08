import assert from 'node:assert/strict'
import { discoverReleaseMaterials } from './lib/release-material-discovery.mjs'
const product = { productId: 'vbr', productTitle: 'Veeam Backup & Replication' }
const payload = { payload: { products: [{ productTitle: 'Veeam Backup &amp; Replication' }] } }
const material = { productId: 'vbr', url: 'https://helpcenter.veeam.com/docs/backup/vsphere/overview.html' }
const realPayload = { payload: {
  products: [{ productTitle: product.productTitle, documentGroups: [{ resourceType: 'resourcetype:techdoc/releasenotes', documents: [{ documentTitle: 'Release Notes', links: { html: material.url } }] }] }],
  filters: [{ id: 'version', groups: [{ groupItems: [{ title: '13.1', value: 'product:8/500', selected: true }] }] }],
} }
let realCalls = 0
const realParsed = await discoverReleaseMaterials({ product, fetchPayload: async () => ++realCalls === 1 ? payload : realPayload, sleep: async () => {} })
assert.equal(realCalls, 2)
assert.equal(realParsed.length, 1)
assert.equal(realParsed[0].productId, 'vbr')
assert.equal(realParsed[0].releaseFamily, '13.1')
let calls = 0
const delays = []
assert.deepEqual(await discoverReleaseMaterials({ product, fetchPayload: async () => { calls++; return payload }, parse: () => calls < 3 ? [] : [material], sleep: async ms => { delays.push(ms) } }), [material])
assert.equal(calls, 3)
assert.deepEqual(delays, [3000, 6000])
calls = 0
await assert.rejects(discoverReleaseMaterials({ product, fetchPayload: async () => { calls++; return payload }, parse: () => [], sleep: async () => {} }), /no current document.*after three attempts/)
assert.equal(calls, 3)
for (const failure of ['HTTP 403', 'HTTP 429', 'invalid JSON']) {
  calls = 0
  await assert.rejects(discoverReleaseMaterials({ product, fetchPayload: async () => { calls++; throw new Error(failure) }, sleep: async () => assert.fail('Do not retry retrieval errors here') }), new RegExp(failure))
  assert.equal(calls, 1)
}
await assert.rejects(discoverReleaseMaterials({ product, fetchPayload: async () => ({ payload: { products: [{ productTitle: 'Veeam ONE' }] } }), sleep: async () => assert.fail('Do not retry wrong products') }), /mismatched product response/)
await assert.rejects(discoverReleaseMaterials({ product, fetchPayload: async () => payload, parse: () => [{ ...material, productId: 'vro' }], sleep: async () => assert.fail('Do not retry parser defects') }), /parser returned a mismatched product/)
await assert.rejects(discoverReleaseMaterials({ product, fetchPayload: async () => payload, parse: () => { throw new Error('Parser defect') }, sleep: async () => assert.fail('Do not retry parser defects') }), /Parser defect/)
console.log('Release material discovery retry tests passed.')
