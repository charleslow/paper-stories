import { describe, it, expect, vi } from 'vitest'
import { isSafeId, buildChatPrompt, readBody, withFileLock, type BuildChatPromptInput } from './chat-utils'
import { EventEmitter } from 'events'

describe('isSafeId', () => {
  it('accepts valid alphanumeric IDs', () => {
    expect(isSafeId('chapter-1')).toBe(true)
    expect(isSafeId('my-story_v2.0')).toBe(true)
    expect(isSafeId('abc123')).toBe(true)
  })

  it('rejects path traversal attempts', () => {
    expect(isSafeId('../etc/passwd')).toBe(false)
    expect(isSafeId('foo..bar')).toBe(false)
    expect(isSafeId('../../secret')).toBe(false)
  })

  it('rejects empty or whitespace strings', () => {
    expect(isSafeId('')).toBe(false)
    expect(isSafeId(' ')).toBe(false)
  })

  it('rejects IDs starting with special characters', () => {
    expect(isSafeId('.hidden')).toBe(false)
    expect(isSafeId('-dash')).toBe(false)
    expect(isSafeId('_underscore')).toBe(false)
  })

  it('rejects IDs with path separators', () => {
    expect(isSafeId('foo/bar')).toBe(false)
    expect(isSafeId('foo\\bar')).toBe(false)
  })
})

describe('buildChatPrompt', () => {
  const baseInput: BuildChatPromptInput = {
    message: 'What is attention?',
    title: 'Test Paper',
    arxivId: '2401.00001',
    currentChapter: {
      label: 'Chapter 1',
      excerpts: [{ latexSource: 'Attention is key.', type: 'text' }],
      explanation: 'This chapter explains attention.',
    },
    prevChapter: null,
    nextChapter: null,
    overviewChapter: null,
    totalChapters: 3,
    history: [],
  }

  it('includes paper metadata and current chapter', () => {
    const prompt = buildChatPrompt(baseInput)
    expect(prompt).toContain('Test Paper')
    expect(prompt).toContain('2401.00001')
    expect(prompt).toContain('Chapter 1')
    expect(prompt).toContain('Attention is key.')
    expect(prompt).toContain('What is attention?')
  })

  it('includes overview chapter when provided', () => {
    const prompt = buildChatPrompt({
      ...baseInput,
      overviewChapter: { label: 'Paper Overview', explanation: 'This paper studies attention.' },
    })
    expect(prompt).toContain('Paper Overview')
    expect(prompt).toContain('This paper studies attention.')
  })

  it('includes adjacent chapters when provided', () => {
    const prompt = buildChatPrompt({
      ...baseInput,
      prevChapter: { label: 'Intro', explanation: 'The intro.' },
      nextChapter: { label: 'Methods', explanation: 'The methods.' },
    })
    expect(prompt).toContain('Previous Chapter: "Intro"')
    expect(prompt).toContain('Next Chapter: "Methods"')
  })

  it('includes conversation history', () => {
    const prompt = buildChatPrompt({
      ...baseInput,
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    })
    expect(prompt).toContain('Prior conversation:')
    expect(prompt).toContain('user: Hi')
    expect(prompt).toContain('assistant: Hello!')
  })

  it('truncates long history to last 20 messages', () => {
    const longHistory = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }))
    const prompt = buildChatPrompt({
      ...baseInput,
      history: longHistory,
    })
    // Should contain the last messages but not the first
    expect(prompt).toContain('Message 29')
    expect(prompt).toContain('Message 10')
    expect(prompt).not.toContain('Message 9')
    expect(prompt).toContain('last 20 of 30 messages')
  })

  it('omits history section when empty', () => {
    const prompt = buildChatPrompt(baseInput)
    expect(prompt).not.toContain('Prior conversation')
  })
})

describe('readBody', () => {
  function createMockRequest() {
    const emitter = new EventEmitter()
    // Add minimal IncomingMessage properties
    ;(emitter as unknown as Record<string, unknown>).destroy = vi.fn()
    return emitter
  }

  it('reads a normal request body', async () => {
    const req = createMockRequest()
    const promise = readBody(req as never)
    req.emit('data', Buffer.from('{"hello":'))
    req.emit('data', Buffer.from('"world"}'))
    req.emit('end')
    const result = await promise
    expect(result).toBe('{"hello":"world"}')
  })

  it('rejects bodies exceeding the size limit', async () => {
    const req = createMockRequest()
    const promise = readBody(req as never)
    // Send a chunk larger than 512KB
    const bigChunk = Buffer.alloc(600 * 1024, 'x')
    req.emit('data', bigChunk)
    await expect(promise).rejects.toThrow('Request body too large')
  })

  it('rejects on stream error', async () => {
    const req = createMockRequest()
    const promise = readBody(req as never)
    req.emit('error', new Error('stream broke'))
    await expect(promise).rejects.toThrow('stream broke')
  })
})

describe('withFileLock', () => {
  it('serializes concurrent operations on the same file', async () => {
    const order: number[] = []

    const op1 = withFileLock('/fake/path', async () => {
      order.push(1)
      await new Promise(r => setTimeout(r, 50))
      order.push(2)
      return 'a'
    })

    const op2 = withFileLock('/fake/path', async () => {
      order.push(3)
      return 'b'
    })

    const [r1, r2] = await Promise.all([op1, op2])
    expect(r1).toBe('a')
    expect(r2).toBe('b')
    // op2 should start after op1 finishes
    expect(order).toEqual([1, 2, 3])
  })

  it('allows concurrent operations on different files', async () => {
    const order: string[] = []

    const op1 = withFileLock('/file/a', async () => {
      order.push('a-start')
      await new Promise(r => setTimeout(r, 30))
      order.push('a-end')
    })

    const op2 = withFileLock('/file/b', async () => {
      order.push('b-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('b-end')
    })

    await Promise.all([op1, op2])
    // Both should start before either ends
    expect(order.indexOf('a-start')).toBeLessThan(order.indexOf('a-end'))
    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('b-end'))
  })

  it('releases lock even when the operation throws', async () => {
    await expect(
      withFileLock('/fail/path', async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')

    // Lock should be released — next operation should succeed
    const result = await withFileLock('/fail/path', async () => 'ok')
    expect(result).toBe('ok')
  })
})
