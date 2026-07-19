import { readFile } from 'node:fs/promises'
import { mergeCisaKev, parseCisaKev } from './lib/cisa-kev.mjs'

const fixture = JSON.parse(await readFile(new URL('../src/data/fixtures/cisa-kev.fixture.json', import.meta.url), 'utf8'))
const kevCves = parseCisaKev(fixture)
if (!kevCves.has('CVE-2024-40711')) throw new Error('Expected Veeam KEV record was not parsed')

const base = { securityFindings: [{ cves: ['CVE-2024-40711'], sourceIds: ['kb4649'] }, { cves: ['CVE-2024-40713'], sourceIds: ['kb4649'] }] }
const merged = mergeCisaKev(base, kevCves)
if (merged.matches !== 1 || !merged.catalog.securityFindings[0].isCisaKev || merged.catalog.securityFindings[1].isCisaKev) throw new Error('CISA KEV merge did not mark only matching CVEs')
console.log('CISA KEV adapter fixture test passed.')
