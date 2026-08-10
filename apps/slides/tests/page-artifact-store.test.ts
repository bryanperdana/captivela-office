import { describe, expect, it } from 'vitest'
import { PageArtifactStore } from '../src/main/ai-generation/artifact-store'

function storeAt(nowRef: { value: number }, maxEntries = 200) {
  let id = 0
  return new PageArtifactStore({
    ttlMs: 1_000,
    maxEntries,
    now: () => nowRef.value,
    idFactory: () => `artifact-${++id}`,
  })
}

describe('PageArtifactStore', () => {
  it('issues an opaque id + SHA-256 digest and returns a defensive byte copy once', () => {
    const clock = { value: 0 }
    const store = storeAt(clock)
    const source = new Uint8Array([1, 2, 3])
    const artifact = store.issue(7, source)
    source[0] = 99

    expect(artifact).toEqual({
      schema: 'captivela.page-generation-artifact/v1',
      artifactId: 'artifact-1',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect([...store.consume(7, artifact)]).toEqual([1, 2, 3])
    expect(() => store.consume(7, artifact)).toThrow(/unknown or expired/)
  })

  it('keeps revision and immutable deck-session identity in main-process metadata only', () => {
    const store = storeAt({ value: 0 })
    const artifact = store.issue(7, new Uint8Array([9]), 12, 'deck_session_123')
    expect(artifact).not.toHaveProperty('expectedRevision')
    expect(artifact).not.toHaveProperty('expectedSessionId')
    expect(store.consumeWithMetadata(7, artifact)).toEqual({
      bytes: new Uint8Array([9]),
      expectedRevision: 12,
      expectedSessionId: 'deck_session_123',
    })
  })

  it('strictly rejects unknown envelope keys and malformed ids without consuming the artifact', () => {
    const store = storeAt({ value: 0 })
    const artifact = store.issue(7, new Uint8Array([8]))
    expect(() =>
      store.consume(7, { ...artifact, path: '/tmp/injected.pptx' } as typeof artifact),
    ).toThrow(/invalid artifact envelope/)
    expect(() => store.consume(7, { ...artifact, artifactId: '../escape' })).toThrow(
      /invalid artifact id/,
    )
    expect([...store.consume(7, artifact)]).toEqual([8])
  })

  it('rejects cross-renderer consumption without consuming the artifact', () => {
    const store = storeAt({ value: 0 })
    const artifact = store.issue(11, new Uint8Array([4]))
    expect(() => store.consume(12, artifact)).toThrow(/another renderer/)
    expect([...store.consume(11, artifact)]).toEqual([4])
  })

  it('rejects a tampered digest without consuming the artifact', () => {
    const store = storeAt({ value: 0 })
    const artifact = store.issue(1, new Uint8Array([5]))
    expect(() => store.consume(1, { ...artifact, digest: '0'.repeat(64) })).toThrow(/digest mismatch/)
    expect([...store.consume(1, artifact)]).toEqual([5])
  })

  it('expires artifacts and revokes every artifact owned by a closed renderer', () => {
    const clock = { value: 0 }
    const store = storeAt(clock)
    const expired = store.issue(1, new Uint8Array([1]))
    clock.value = 1_000
    expect(() => store.consume(1, expired)).toThrow(/unknown or expired/)

    clock.value = 1_001
    const first = store.issue(2, new Uint8Array([2]))
    const second = store.issue(2, new Uint8Array([3]))
    store.revokeOwner(2)
    expect(() => store.consume(2, first)).toThrow(/unknown or expired/)
    expect(() => store.consume(2, second)).toThrow(/unknown or expired/)
  })

  it('stays bounded by evicting the oldest entry', () => {
    const store = storeAt({ value: 0 }, 2)
    const oldest = store.issue(1, new Uint8Array([1]))
    const middle = store.issue(1, new Uint8Array([2]))
    const newest = store.issue(1, new Uint8Array([3]))
    expect(store.size).toBe(2)
    expect(() => store.consume(1, oldest)).toThrow(/unknown or expired/)
    expect([...store.consume(1, middle)]).toEqual([2])
    expect([...store.consume(1, newest)]).toEqual([3])
  })

  it('rejects empty bytes and invalid constructor limits', () => {
    expect(() => new PageArtifactStore({ ttlMs: 0 })).toThrow(/ttl/)
    expect(() => new PageArtifactStore({ maxEntries: 0 })).toThrow(/maxEntries/)
    const store = storeAt({ value: 0 })
    expect(() => store.issue(1, new Uint8Array())).toThrow(/empty/)
  })
})
