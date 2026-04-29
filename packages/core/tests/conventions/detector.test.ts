import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { detect } from '../../src/conventions/detector.js'
import { updateForChangedFiles } from '../../src/conventions/incremental.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES = join(__dirname, 'fixtures')

// Fixture roots (not real git repos, so we pass explicit file lists)
const TS_CAMEL_ROOT = join(FIXTURES, 'ts-camel')
const TS_CAMEL_FILES = [
  'src/userService.ts',
  'src/authHelper.ts',
  'src/dataUtils.ts',
  'tests/userService.test.ts',
]

const PY_MIXED_ROOT = join(FIXTURES, 'py-mixed')
const PY_MIXED_FILES = [
  'src/data_processor.py',
  'src/utils.py',
]

describe('detect — TypeScript camelCase fixture', () => {
  it('identifies camelCase as dominant function naming style', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const ts = profiles.find((p) => p.language === 'typescript')
    expect(ts).toBeDefined()

    const fnConvention = ts!.conventions.find((c) => c.category === 'functionNames')
    expect(fnConvention).toBeDefined()
    expect(fnConvention!.pattern).toBe('camelCase')
    // 80%+ threshold ±2% tolerance → score must be >=78
    expect(fnConvention!.score).toBeGreaterThanOrEqual(78)
  })

  it('detects PascalCase as dominant class naming style', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const ts = profiles.find((p) => p.language === 'typescript')
    expect(ts).toBeDefined()

    const classConvention = ts!.conventions.find((c) => c.category === 'classNames')
    if (classConvention) {
      expect(classConvention.pattern).toBe('PascalCase')
    }
  })

  it('reports analyzed file count', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const ts = profiles.find((p) => p.language === 'typescript')
    expect(ts).toBeDefined()
    expect(ts!.analyzedFiles).toBe(TS_CAMEL_FILES.length)
  })

  it('includes analyzedAt ISO timestamp', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const ts = profiles.find((p) => p.language === 'typescript')
    expect(ts).toBeDefined()
    expect(() => new Date(ts!.analyzedAt)).not.toThrow()
    expect(new Date(ts!.analyzedAt).getFullYear()).toBeGreaterThanOrEqual(2024)
  })
})

describe('detect — Python mixed-style fixture', () => {
  it('identifies snake_case as dominant function naming style', async () => {
    const profiles = await detect(PY_MIXED_ROOT, { files: PY_MIXED_FILES })
    const py = profiles.find((p) => p.language === 'python')
    expect(py).toBeDefined()

    const fnConvention = py!.conventions.find((c) => c.category === 'functionNames')
    expect(fnConvention).toBeDefined()
    expect(fnConvention!.pattern).toBe('snake_case')
    // snake_case should dominate (>=78% given the fixture content)
    expect(fnConvention!.score).toBeGreaterThanOrEqual(78)
  })
})

describe('detect — consistency scores', () => {
  it('score is between 0 and 100', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    for (const profile of profiles) {
      for (const convention of profile.conventions) {
        expect(convention.score).toBeGreaterThanOrEqual(0)
        expect(convention.score).toBeLessThanOrEqual(100)
      }
    }
  })

  it('sampleCount is positive', async () => {
    const profiles = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const ts = profiles.find((p) => p.language === 'typescript')
    expect(ts).toBeDefined()
    for (const c of ts!.conventions) {
      expect(c.sampleCount).toBeGreaterThan(0)
    }
  })
})

describe('updateForChangedFiles — incremental re-scan', () => {
  it('re-scans only the affected language and returns updated profile', async () => {
    // Baseline: full detect
    const baseline = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const existingMap = new Map(baseline.map((p) => [p.language, p]))

    // Incremental: one .ts file changed
    const updated = await updateForChangedFiles(
      TS_CAMEL_ROOT,
      existingMap,
      ['src/userService.ts'],
      { files: TS_CAMEL_FILES },
    )

    const ts = updated.get('typescript')
    expect(ts).toBeDefined()

    // Dominant style should still be camelCase after re-scan
    const fnConvention = ts!.conventions.find((c) => c.category === 'functionNames')
    expect(fnConvention?.pattern).toBe('camelCase')
  })

  it('returns existing profile unchanged for unaffected languages', async () => {
    const baseline = await detect(TS_CAMEL_ROOT, { files: TS_CAMEL_FILES })
    const existingMap = new Map(baseline.map((p) => [p.language, p]))

    // Change a .py file — no python files in the ts-camel fixture, so typescript should be re-scanned
    const updated = await updateForChangedFiles(
      TS_CAMEL_ROOT,
      existingMap,
      ['src/something.go'],  // .go file — not in the fixture
      { files: TS_CAMEL_FILES },
    )

    // TypeScript profile should be unchanged (go changed, not ts)
    const ts = updated.get('typescript')
    const original = existingMap.get('typescript')
    expect(ts?.analyzedAt).toBe(original?.analyzedAt)
  })
})
