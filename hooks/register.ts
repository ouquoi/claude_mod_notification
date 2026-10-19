import type { Engine, Register, Timer, TurnUsage } from 'claude-code'

const PREVIEW_LENGTH = 100
const MIN_VISIBLE_COST_USD = 0.01
const MIN_DELAY_SECONDS = 1
const NOTIFICATION_TITLE = 'Claude Code'
const NTFY_URL = 'https://ntfy.sh'
// The mod cannot read its own session's web address, so the button opens the session list.
const CLAUDE_CODE_URL = 'https://claude.ai/code'
const OPEN_BUTTON_LABEL = 'Open Claude Code'

const toPreview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

const formatTokens = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)

const formatCost = (costUsd: number): string =>
  costUsd < MIN_VISIBLE_COST_USD ? `<$${MIN_VISIBLE_COST_USD.toFixed(2)}` : `$${costUsd.toFixed(2)}`

// Input counts cached tokens too, so it matches what the model actually read.
const formatUsage = (usage: TurnUsage | undefined, costUsd: number | undefined): string => {
  const parts: string[] = []
  if (usage !== undefined) {
    const inputTokens =
      usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    parts.push(`${formatTokens(inputTokens)} in / ${formatTokens(usage.output_tokens)} out`)
  }
  if (costUsd !== undefined) parts.push(formatCost(costUsd))
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

const readSessionCostUsd = async ($: Engine): Promise<number | undefined> => {
  try {
    return (await $.session.usage()).cost?.usd
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mod-notification: cost unavailable (${reason})`)
    return undefined
  }
}

const getProjectName =async ($: Engine): Promise<string> => {
  const directory = await $.session.cwd()
  const segments = directory.split(/[\\/]/).filter(segment => segment.length > 0)
  return segments[segments.length - 1] ?? directory
}

// The end of an answer is where Claude asks its question or sums up the result.
const toLastSentence = (text: string): string => {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*]/g, '')
    .replace(/^\s*(?:[-•>#]+)\s*/gm, '')
  const lines = plain
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const lastLine = lines[lines.length - 1] ?? ''
  const sentences = lastLine.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [lastLine]
  return (sentences[sentences.length - 1] ?? lastLine).trim()
}

const withPreview = (message: string, preview: string, isEnabled: boolean): string =>
  isEnabled && preview.length > 0 ? `${message} « ${toPreview(preview)} »` : message

const sendNotification = async ($: Engine, text: string): Promise<void> => {
  try {
    const result = await $.ui.notify(text, { title: NOTIFICATION_TITLE })
    if (!result.isSent) {
      $.ui.log(`mod-notification: not sent (${result.reason})`)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mod-notification: notify failed (${reason})`)
  }
}

// ntfy pushes to the phone with no model turn, so it costs no tokens.
const sendPhonePush = async ($: Engine, topic: string, text: string): Promise<void> => {
  try {
    const response = await $.http.fetch(NTFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: NOTIFICATION_TITLE,
        message: text,
        click: CLAUDE_CODE_URL,
        actions: [{ action: 'view', label: OPEN_BUTTON_LABEL, url: CLAUDE_CODE_URL }],
      }),
    })
    if (!response.ok) {
      $.ui.log(`mod-notification: phone push refused (HTTP ${response.status})`)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mod-notification: phone push failed (${reason})`)
  }
}

const alertPerson = async ($: Engine, ntfyTopic: string, message: string): Promise<void> => {
  if (ntfyTopic.length === 0) {
    $.ui.log('mod-notification: ntfyTopic is not set, no phone push')
  }
  await Promise.all([
    sendNotification($, message),
    ntfyTopic.length > 0 ? sendPhonePush($, ntfyTopic, message) : Promise.resolve(),
  ])
}

const readNtfyTopic =(value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const register: Register = (on, options) => {
  const delaySeconds = Math.max(MIN_DELAY_SECONDS, Number(options.delaySeconds))
  const delayMs = delaySeconds * 1000
  const isPreviewIncluded = options.includePreview === true
  const ntfyTopic = readNtfyTopic(options.ntfyTopic)

  // Timer started when a turn ends; cancelled as soon as the person comes back.
  let idleTimer: Timer | undefined

  // Session cost when the current main-loop turn started; the turn's price is the gap.
  let turnStartCostUsd: number | undefined

  const cancelIdleTimer = (): void => {
    idleTimer?.cancel()
    idleTimer = undefined
  }

  on('turn.complete', async ($, e, next) => {
    const isMainLoop = e.agentId === undefined
    if (isMainLoop && (e.reason === 'answer' || e.reason === 'error')) {
      cancelIdleTimer()
      const project = await getProjectName($)
      const endCostUsd = await readSessionCostUsd($)
      const turnCostUsd =
        endCostUsd !== undefined && turnStartCostUsd !== undefined
          ? Math.max(0, endCostUsd - turnStartCostUsd)
          : undefined
      const duration = formatDuration(e.durationMs) + formatUsage(e.usage, turnCostUsd)
      const preview = toLastSentence(e.answer)
      const message =
        e.reason === 'error'
          ? withPreview(
              `❌ "${project}" · ${duration}. Claude stopped on an error.`,
              preview,
              isPreviewIncluded,
            )
          : withPreview(
              `✅ "${project}" · ${duration}. Claude is waiting for you.`,
              preview,
              isPreviewIncluded,
            )
      idleTimer = $.clock.after(delayMs, () => {
        idleTimer = undefined
        void alertPerson($, ntfyTopic, message)
      })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      cancelIdleTimer()
      turnStartCostUsd = await readSessionCostUsd($)
    }
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    cancelIdleTimer()
    return next(e)
  })

  on('session.end', ($, e, next) => {
    cancelIdleTimer()
    return next(e)
  })

  // The tool call resolves only once the person has answered the dialog.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const project = await getProjectName($)
    const firstQuestion = e.questions[0]?.question ?? ''
    const questionTimer = $.clock.after(delayMs, () => {
      const message = withPreview(
        `❓ "${project}". Claude is asking you something.`,
        firstQuestion,
        isPreviewIncluded,
      )
      void alertPerson($, ntfyTopic, message)
    })
    try {
      return await next(e)
    } finally {
      questionTimer.cancel()
    }
  })
}
