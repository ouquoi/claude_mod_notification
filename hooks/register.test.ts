import { expect, mock, test } from 'claude-code/testing'

const completeInput = {
  answer: 'Build is done',
  durationMs: 1200,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const

// Records every prompt reaching the engine; the mod's push request is one of them.
const trackSubmittedPrompts = (on: Parameters<typeof mock.clock>[0]): string[] => {
  const submitted: string[] = []
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo_project' }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return submitted
}

test('asks for a phone push once the delay has passed after a finished turn', { options: { delaySeconds: 5, includePreview: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)

  await $.turn.complete(completeInput)
  await clock.advance(4000)
  expect(submitted).toEqual([])

  await clock.advance(1500)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('PushNotification')
  expect(submitted[0]).toContain('✅ "demo_project" · 1s. Claude is waiting for you.')
  expect(submitted[0]).not.toContain('Build is done')
})

test('shows the turn tokens and its price in the message', { options: { delaySeconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)
  const sessionCosts = [1, 1.25]
  on('turn.start', () => ({ turnId: 'turn-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
      cost: { usd: sessionCosts.shift() ?? 0 },
    },
  }))

  await $.turn.start({ turnId: 'turn-1' })
  await $.turn.complete({
    ...completeInput,
    usage: {
      model: 'claude-sonnet-5-5',
      input_tokens: 1000,
      cache_read_input_tokens: 10000,
      cache_creation_input_tokens: 1400,
      output_tokens: 1200,
    },
  })
  await clock.advance(6000)

  expect(submitted[0]).toContain('✅ "demo_project" · 1s · 12.4k in / 1.2k out · $0.25. Claude is waiting for you.')
})

test('appends the end of the answer when includePreview is on', { options: { delaySeconds: 5, includePreview: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)

  await $.turn.complete(completeInput)
  await clock.advance(6000)

  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Claude is waiting for you. « Build is done »')
})

test('keeps only the last sentence of a long markdown answer', { options: { delaySeconds: 5, includePreview: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = []
  const answer = '## Result\n\nI changed `menu.ts`. All tests pass.\n\n```ts\nconst x = 1\n```\n\n- Done here. Do you want the old menu or the new one?'
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo_project' }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  await $.turn.complete({ ...completeInput, answer })
  await clock.advance(6000)

  expect(submitted[0]).toContain('« Do you want the old menu or the new one? »')
  expect(submitted[0]).not.toContain('All tests pass')
})

test('does not ask for a push when the person submits a prompt in time', { options: { delaySeconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)

  await $.turn.complete(completeInput)
  await clock.advance(2000)
  await $.prompt.submit({ text: 'next question' })
  await clock.advance(10000)

  expect(submitted).toEqual(['next question'])
})

test('ignores a turn interrupted by the person', { options: { delaySeconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)

  await $.turn.complete({ ...completeInput, isAborted: true, reason: 'aborted' })
  await clock.advance(10000)

  expect(submitted).toEqual([])
})

test('the push turn itself does not schedule another push', { options: { delaySeconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted = trackSubmittedPrompts(on)

  await $.turn.complete(completeInput)
  await clock.advance(6000)
  await $.turn.complete({ ...completeInput, answer: 'ok', turnId: 'turn-2' })
  await clock.advance(20000)

  expect(submitted.length).toBe(1)
})
