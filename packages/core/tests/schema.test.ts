import { describe, it, expect } from 'vitest'
import {
  tagsToStrings,
  tagsFromStrings,
  decisionTags,
  bugTags,
  type MindrTag,
} from '../src/schema.js'

describe('tagsToStrings', () => {
  it('prefixes each tag with mindr:', () => {
    const tags: MindrTag[] = [
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'core' },
    ]
    expect(tagsToStrings(tags)).toEqual(['mindr:type:decision', 'mindr:module:core'])
  })
})

describe('tagsFromStrings', () => {
  it('parses mindr: strings back to tags', () => {
    expect(tagsFromStrings(['mindr:type:decision', 'mindr:module:core'])).toEqual([
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'core' },
    ])
  })

  it('ignores strings without mindr: prefix', () => {
    expect(tagsFromStrings(['other:tag', 'mindr:type:note', 'bare'])).toEqual([
      { key: 'type', value: 'note' },
    ])
  })

  it('preserves colons in the value segment', () => {
    expect(tagsFromStrings(['mindr:id:abc:def'])).toEqual([{ key: 'id', value: 'abc:def' }])
  })
})

describe('round-trip', () => {
  it('tags → strings → tags is identity', () => {
    const original: MindrTag[] = [
      { key: 'type', value: 'bug_pattern' },
      { key: 'module', value: 'auth' },
      { key: 'language', value: 'typescript' },
    ]
    expect(tagsFromStrings(tagsToStrings(original))).toEqual(original)
  })
})

describe('helper builders', () => {
  it('decisionTags includes type, module, commit, confidence', () => {
    const tags = decisionTags({ module: 'core', commit: 'abc123', confidence: 'high' })
    expect(tags).toContainEqual({ key: 'type', value: 'decision' })
    expect(tags).toContainEqual({ key: 'module', value: 'core' })
    expect(tags).toContainEqual({ key: 'commit', value: 'abc123' })
    expect(tags).toContainEqual({ key: 'confidence', value: 'high' })
  })

  it('decisionTags omits optional fields when not provided', () => {
    const tags = decisionTags({ module: 'core' })
    expect(tags.map((t) => t.key)).not.toContain('commit')
    expect(tags.map((t) => t.key)).not.toContain('confidence')
  })

  it('bugTags includes type, module, language, fingerprint', () => {
    const tags = bugTags({ module: 'parser', language: 'ts', fingerprint: 'fp1' })
    expect(tags).toContainEqual({ key: 'type', value: 'bug_pattern' })
    expect(tags).toContainEqual({ key: 'language', value: 'ts' })
    expect(tags).toContainEqual({ key: 'fingerprint', value: 'fp1' })
  })
})
