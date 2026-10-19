import { expect, mock, test } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]

type Alerts = {
  desktop: string[]
  phone: { url: string; body: string }[]
  logs: string[]
}

const completeInput = {
  answer: 'Build is done',
  durationMs: 1200,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const

const askInput = {
  tool: 'AskUserQuestion',
  questions: [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Blue', description: 'Blue' }, { label: 'Red', description: 'Red' }] }],
} as const

const openButton = {
  click: 'https://claude.ai/code',
  actions: [{ action: 'view', label: 'Open Claude Code', url: 'https://claude.ai/code' }],
}

const OK_RESPONSE = { status: 200, ok: true, headers: {}, text: '' }

// Records what the mod sends: the desktop notification, the ntfy request, its logs.
const trackAlerts = (on: On, response = OK_RESPONSE): Alerts => {
  const alerts: Alerts = { desktop: [], phone: [], logs: [] }
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo_project' }))
  on('ui.notify', (_$, e) => {
    alerts.desktop.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('http.fetch', (_$, e) => {
    alerts.phone.push({ url: e.url, body: e.init?.body ?? '' })
    return { value: response }
  })
  on('ui.log', (_$, e) => {
    alerts.logs.push(e.text)
    return { value: undefined }
  })
  return alerts
}

// Answers the question dialog only when the test calls the returned function.
const holdQuestionDialog = (on: On): (() => void) => {
  let answer: () => void = () => undefined
  const answered = new Promise<void>(resolve => {
    answer = resolve
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    await answered
    return { result: {}, text: 'answered' }
  })
  return answer
}

const options = { delaySeconds: 5, ntfyTopic: 'secret-topic' }

test('sends a desktop notification and a phone push once the delay has passed after a finished turn', { options: { ...options, includePreview: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)

  await $.turn.complete(completeInput)
  await clock.advance(4000)
  expect(alerts.phone).toEqual([])

  await clock.advance(1500)
  const message = '✅ "demo_project" · 1s. Claude is waiting for you.'
  expect(alerts.desktop).toEqual([message])
  expect(alerts.phone.length).toBe(1)
  expect(alerts.phone[0]?.url).toBe('https://ntfy.sh')
  expect(JSON.parse(alerts.phone[0]?.body ?? '{}')).toEqual({ topic: 'secret-topic', title: 'Claude Code', message, ...openButton })
})

test('shows the turn tokens and its price in the message', { options: { ...options, includePreview: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)
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

  expect(alerts.desktop).toEqual(['✅ "demo_project" · 1s · 12.4k in / 1.2k out · $0.25. Claude is waiting for you.'])
})

test('appends the end of the answer when includePreview is on', { options: { ...options, includePreview: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)

  await $.turn.complete(completeInput)
  await clock.advance(6000)

  expect(alerts.desktop).toEqual(['✅ "demo_project" · 1s. Claude is waiting for you. « Build is done »'])
})

test('keeps only the last sentence of a long markdown answer', { options: { ...options, includePreview: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)
  const answer = '## Result\n\nI changed `menu.ts`. All tests pass.\n\n```ts\nconst x = 1\n```\n\n- Done here. Do you want the old menu or the new one?'

  await $.turn.complete({ ...completeInput, answer })
  await clock.advance(6000)

  expect(alerts.desktop[0]).toContain('« Do you want the old menu or the new one? »')
  expect(alerts.desktop[0]).not.toContain('All tests pass')
})

test('does not notify when the person submits a prompt in time', { options }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))

  await $.turn.complete(completeInput)
  await clock.advance(2000)
  await $.prompt.submit({ text: 'next question' })
  await clock.advance(10000)

  expect(alerts.desktop).toEqual([])
  expect(alerts.phone).toEqual([])
})

test('ignores a turn interrupted by the person', { options }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)

  await $.turn.complete({ ...completeInput, isAborted: true, reason: 'aborted' })
  await clock.advance(10000)

  expect(alerts.desktop).toEqual([])
  expect(alerts.phone).toEqual([])
})

test('notifies when a question stays unanswered after the delay', { options: { ...options, includePreview: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)
  const answer = holdQuestionDialog(on)

  const asked = $.tool.call(askInput)
  await clock.advance(4000)
  expect(alerts.phone).toEqual([])

  await clock.advance(1500)
  const message = '❓ "demo_project". Claude is asking you something. « Which color? »'
  expect(alerts.desktop).toEqual([message])
  expect(alerts.phone.length).toBe(1)
  expect(JSON.parse(alerts.phone[0]?.body ?? '{}')).toEqual({ topic: 'secret-topic', title: 'Claude Code', message, ...openButton })

  answer()
  await asked
})

test('does not notify when the question is answered in time', { options }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)
  const answer = holdQuestionDialog(on)

  const asked = $.tool.call(askInput)
  await clock.advance(2000)
  answer()
  await asked
  await clock.advance(10000)

  expect(alerts.desktop).toEqual([])
  expect(alerts.phone).toEqual([])
})

test('sends only the desktop notification and says so when no ntfy topic is set', { options: { delaySeconds: 5, ntfyTopic: '' } }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on)

  await $.turn.complete(completeInput)
  await clock.advance(6000)

  expect(alerts.desktop.length).toBe(1)
  expect(alerts.phone).toEqual([])
  expect(alerts.logs).toContain('mod-notification: ntfyTopic is not set, no phone push')
})

test('logs the status when ntfy refuses the push', { options }, async ($, on) => {
  const clock = mock.clock(on)
  const alerts = trackAlerts(on, { status: 404, ok: false, headers: {}, text: 'not found' })

  await $.turn.complete(completeInput)
  await clock.advance(6000)

  expect(alerts.logs).toContain('mod-notification: phone push refused (HTTP 404)')
})
