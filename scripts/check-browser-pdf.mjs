import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

if (!process.env.BROWSER_TEST_ROOT) throw new Error('Set BROWSER_TEST_ROOT to the isolated Playwright installation directory')
const require = createRequire(join(resolve(process.env.BROWSER_TEST_ROOT), 'package.json'))
const { chromium } = require('playwright')
const outputDirectory = 'artifacts/browser-pdf'
await mkdir(outputDirectory, { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'inherit' })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) })
      if (response.ok) { ready = true; break }
    } catch { /* Wait for the local preview process. */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready, 'Preview server must start')
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
  const current = catalog.releases.find(release => release.id === catalog.products.find(product => product.id === 'vbr').recommendedReleaseId)
  assert.ok(current, 'Current VBR release must exist')
  for (const version of ['13.0.1.180', '11a', current.aliases[0]]) {
    await page.goto('http://127.0.0.1:4173/?product=vbr&version=' + encodeURIComponent(version))
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download executive summary (PDF)' }).click()
    const download = await downloadPromise
    assert.equal(await download.failure(), null)
    const path = join(outputDirectory, version.replaceAll(/[^a-z0-9.-]/gi, '-') + '.pdf')
    await download.saveAs(path)
    const bytes = new Uint8Array(await readFile(path))
    const byteLength = bytes.length // PDF.js may transfer and detach this buffer.
    assert.ok(byteLength > 1000)
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
    const document = await getDocument({
      data: bytes, useWorkerFetch: false, isEvalSupported: false,
      standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/',
    }).promise
    try {
      let text = ''
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        text += (await (await document.getPage(pageNumber)).getTextContent()).items.map(item => item.str ?? '').join(' ')
      }
      assert.match(text, /DECISION SUMMARY/)
      assert.match(text, /Veeam Backup & Replication/)
      const expectedRelease = version === current.aliases[0] ? current.name : version
      assert.ok(text.replace(/\s+/g, ' ').includes(expectedRelease.replace(/\s+/g, ' ')), 'PDF must describe the selected release')
      console.log(JSON.stringify({ version, pages: document.numPages, filename: download.suggestedFilename(), bytes: byteLength, status: 'browser-pdf-verified' }))
    } finally { await document.destroy() }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  server.kill()
}
