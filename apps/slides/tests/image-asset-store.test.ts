import { describe, expect, it } from 'vitest'
import { ImageAssetStore } from '../src/main/ai-generation/image-asset-store'

const context = {
  ownerId: 7,
  deckSessionId: 'deck_session_123',
  expectedRevision: 4,
  runId: 'run_12345678',
}

function storeAt(clock: { value: number }, maxEntries = 32) {
  return new ImageAssetStore({ ttlMs: 1_000, maxEntries, now: () => clock.value })
}

describe('ImageAssetStore', () => {
  it('stores normalized assets by opaque semantic asset id, digest, and defensive copies', () => {
    const store = storeAt({ value: 0 })
    const source = new Uint8Array([1, 2, 3])
    const stored = store.put({ ...context, assetId: 'hero-image', ext: 'png', bytes: source })
    source[0] = 99

    expect(stored).toEqual({
      assetId: 'hero-image',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      ext: 'png',
    })
    const first = store.get({ ...context, assetId: stored.assetId, digest: stored.digest })
    expect(first).toEqual({ bytes: new Uint8Array([1, 2, 3]), ext: 'png' })
    first.bytes[0] = 88
    expect(store.get({ ...context, assetId: stored.assetId, digest: stored.digest }).bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it.each([
    [{ ownerId: 8 }, /owner/],
    [{ deckSessionId: 'deck_session_999' }, /deck session/],
    [{ expectedRevision: 5 }, /revision/],
    [{ runId: 'run_99999999' }, /run/],
  ] as const)('rejects cross-boundary access without revoking the valid asset', (change, message) => {
    const store = storeAt({ value: 0 })
    const asset = store.put({ ...context, assetId: 'hero-image', ext: 'jpg', bytes: new Uint8Array([4]) })
    expect(() => store.get({ ...context, ...change, ...asset })).toThrow(message)
    expect(store.get({ ...context, ...asset }).bytes).toEqual(new Uint8Array([4]))
  })

  it('rejects tampered digests and invalid ids/inputs', () => {
    const store = storeAt({ value: 0 })
    const asset = store.put({ ...context, assetId: 'hero-image', ext: 'png', bytes: new Uint8Array([5]) })
    expect(() => store.get({ ...context, ...asset, digest: '0'.repeat(64) })).toThrow(/digest/)
    expect(() => store.get({ ...context, ...asset, assetId: '../escape' })).toThrow(/asset id/)
    expect(() => store.put({ ...context, assetId: '', ext: 'png', bytes: new Uint8Array([1]) })).toThrow(
      /asset id/,
    )
    expect(() => store.put({ ...context, assetId: 'x', ext: 'gif' as 'png', bytes: new Uint8Array([1]) })).toThrow(
      /extension/,
    )
    expect(() => store.put({ ...context, assetId: 'x', ext: 'png', bytes: new Uint8Array() })).toThrow(
      /empty/,
    )
  })

  it('expires entries and remains capacity bounded by evicting the oldest entry', () => {
    const clock = { value: 0 }
    const store = storeAt(clock, 2)
    const oldest = store.put({ ...context, assetId: 'oldest', ext: 'png', bytes: new Uint8Array([1]) })
    clock.value = 1
    const middle = store.put({ ...context, assetId: 'middle', ext: 'png', bytes: new Uint8Array([2]) })
    clock.value = 2
    const newest = store.put({ ...context, assetId: 'newest', ext: 'png', bytes: new Uint8Array([3]) })
    expect(store.size).toBe(2)
    expect(() => store.get({ ...context, ...oldest })).toThrow(/unknown or expired/)
    expect(store.get({ ...context, ...middle }).bytes[0]).toBe(2)
    expect(store.get({ ...context, ...newest }).bytes[0]).toBe(3)

    clock.value = 1_002
    expect(store.size).toBe(0)
  })

  it('revokes by owner, run, and deck session without touching unrelated assets', () => {
    const store = storeAt({ value: 0 }, 10)
    const a = store.put({ ...context, assetId: 'a', ext: 'png', bytes: new Uint8Array([1]) })
    const bContext = { ...context, runId: 'run_bbbbbbbb' }
    const b = store.put({ ...bContext, assetId: 'b', ext: 'png', bytes: new Uint8Array([2]) })
    const other = { ...context, ownerId: 8, deckSessionId: 'deck_session_888', runId: 'run_cccccccc' }
    const c = store.put({ ...other, assetId: 'c', ext: 'png', bytes: new Uint8Array([3]) })

    store.revokeRun(context.ownerId, context.deckSessionId, context.runId)
    expect(() => store.get({ ...context, ...a })).toThrow(/unknown or expired/)
    expect(store.get({ ...bContext, ...b }).bytes[0]).toBe(2)

    store.revokeDeck(context.ownerId, context.deckSessionId)
    expect(() => store.get({ ...bContext, ...b })).toThrow(/unknown or expired/)
    expect(store.get({ ...other, ...c }).bytes[0]).toBe(3)

    store.revokeOwner(other.ownerId)
    expect(() => store.get({ ...other, ...c })).toThrow(/unknown or expired/)
  })

  it('rejects duplicate asset keys within one run and invalid limits/bindings', () => {
    expect(() => new ImageAssetStore({ ttlMs: 0 })).toThrow(/ttl/)
    expect(() => new ImageAssetStore({ maxEntries: 0 })).toThrow(/maxEntries/)
    const store = storeAt({ value: 0 })
    store.put({ ...context, assetId: 'same', ext: 'png', bytes: new Uint8Array([1]) })
    expect(() =>
      store.put({ ...context, assetId: 'same', ext: 'png', bytes: new Uint8Array([2]) }),
    ).toThrow(/already exists/)
    expect(() =>
      store.put({ ...context, expectedRevision: -1, assetId: 'bad', ext: 'png', bytes: new Uint8Array([1]) }),
    ).toThrow(/revision/)
  })
})
