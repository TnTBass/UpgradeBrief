import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const snapshot = new URL('../src/data/catalog.snapshot.json', import.meta.url)
const candidatePath = process.argv[2]

function runValidation(path) {
  return new Promise((resolve, reject) => {
    const args = ['scripts/validate-catalog.mjs']
    if (path) args.push(path)
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Catalog validation exited ${code}`)))
  })
}

if (!candidatePath) {
  console.log('No candidate catalog supplied. The committed snapshot remains unchanged.')
  await runValidation()
  process.exit(0)
}

JSON.parse(await readFile(candidatePath, 'utf8'))
await runValidation(candidatePath)
await writeFile(snapshot, await readFile(candidatePath))
console.log('Candidate catalog validated and installed.')
