import { readFile } from 'node:fs/promises'
import { mergeVbrSecurityBulletin, parseVbrSecurityBulletin } from './lib/vbr-security.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-security.fixture.html', import.meta.url), 'utf8')
const records = parseVbrSecurityBulletin(fixture)
if (records.length !== 2) throw new Error(`Expected 2 VBR advisories, received ${records.length}`)
if (records[0].cve !== 'CVE-2024-40711' || records[0].cvssScore !== 9.8) throw new Error('Critical VBR CVE was not parsed correctly')

const base = { securityFindings: [{ id: 'keep', sourceIds: ['kb4771'] }, { id: 'old', sourceIds: ['kb4649'] }] }
const merged = mergeVbrSecurityBulletin(base, records)
if (merged.findings !== 2 || merged.catalog.securityFindings.length !== 3) throw new Error('VBR security merge did not replace only the bulletin findings')
console.log('VBR security adapter fixture test passed.')
