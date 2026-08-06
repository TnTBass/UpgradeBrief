import { readFile } from 'node:fs/promises'
import { mergeVbrSecurityBulletin, mergeVeeamOneSecurityBulletin, mergeVspcSecurityBulletin, parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin, parseVspcSecurityBulletin } from './lib/vbr-security.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-security.fixture.html', import.meta.url), 'utf8')
const records = parseVbrSecurityBulletin(fixture)
if (records.length !== 2) throw new Error(`Expected 2 VBR advisories, received ${records.length}`)
if (records[0].cve !== 'CVE-2024-40711' || records[0].cvssScore !== 9.8) throw new Error('Critical VBR CVE was not parsed correctly')

const base = { securityFindings: [{ id: 'keep', productId: 'vbr', sourceIds: ['kb4771'] }, { id: 'old', productId: 'vbr', sourceIds: ['kb4649'] }] }
const merged = mergeVbrSecurityBulletin(base, records)
if (merged.findings !== 2 || merged.catalog.securityFindings.length !== 3) throw new Error('VBR security merge did not replace only the bulletin findings')
const oneRecords = parseVeeamOneSecurityBulletin(fixture)
if (oneRecords.length !== 1 || oneRecords[0].cve !== 'CVE-2024-42024') throw new Error('Veeam ONE section was not isolated and parsed')
if (mergeVeeamOneSecurityBulletin({ securityFindings: [] }, oneRecords).catalog.securityFindings[0].productId !== 'veeam-one') throw new Error('Veeam ONE advisories were not assigned to the correct product')
const vspcRecords = parseVspcSecurityBulletin(fixture)
if (vspcRecords.length !== 5 || vspcRecords[0].cve !== 'CVE-2024-38650' || vspcRecords.at(-1).cve !== 'CVE-2024-45206') throw new Error('VSPC bulletin section was not isolated and parsed')
const vspcMerged = mergeVspcSecurityBulletin({ securityFindings: [] }, vspcRecords)
if (vspcMerged.findings !== 5 || vspcMerged.catalog.securityFindings[0].fixedReleaseId !== 'vspc-build-8-1-0-21377' || vspcMerged.catalog.securityFindings[0].affectedVersionPrefixes.join(',') !== '4.,5.,6.') throw new Error('VSPC bulletin findings were not assigned to the documented affected and fixed builds')
for (const parse of [parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin, parseVspcSecurityBulletin]) {
  let rejectedMissingBoundary = false
  try { parse(fixture.replace(/id="(?:vbrsolution|vonesolution|vspcsolution)"/g, 'id="renamed-solution"')) } catch { rejectedMissingBoundary = true }
  if (!rejectedMissingBoundary) throw new Error('A renamed shared-bulletin boundary did not fail closed')
}
console.log('VBR security adapter fixture test passed.')
