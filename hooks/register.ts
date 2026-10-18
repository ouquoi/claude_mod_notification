import type { Engine, Register, Timer, TurnUsage } from 'claude-code'

const PREVIEW_LENGTH = 100
const MIN_VISIBLE_COST_USD = 0.01
const MIN_DELAY_SECONDS = 1
const NOTIFICATION_TITLE = 'Claude Code'
const PUSH_PROMPT_PREFIX = '[mod-notification]'
const PUSH_TOOL_NAME = 'PushNotification'
const PUSH_REPLY = 'ok'

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

// The mod cannot push to the phone itself: it asks the model to call PushNotification.
const buildPushPrompt = (message: string): string =>
  `${PUSH_PROMPT_PREFIX} Call the PushNotification tool now (status "proactive") with exactly this message, then reply with only "ok": ${message}`

const requestPhonePush = async ($: Engine, message: string): Promise<void> => {
  try {
    await $.prompt.submit({ text: buildPushPrompt(message) })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mod-notification: push request failed (${reason})`)
  }
}

export const register: Register = (on, options) => {
  const delaySeconds = Math.max(MIN_DELAY_SECONDS, Number(options.delaySeconds))
  const delayMs = delaySeconds * 1000
  const isPreviewIncluded = options.includePreview === true

  // Timer started when a turn ends; cancelled as soon as the person comes back.
  let idleTimer: Timer | undefined

  // True from the moment we ask the model to push until that turn ends, so the
  // push turn itself never schedules another notification.
  let isPushTurnPending = false

  // Session cost when the current main-loop turn started; the turn's price is the gap.
  let turnStartCostUsd: number | undefined

  const cancelIdleTimer = (): void => {
    idleTimer?.cancel()
    idleTimer = undefined
  }

  on('turn.complete', async ($, e, next) => {
    const isMainLoop = e.agentId === undefined
    if (isMainLoop && isPushTurnPending) {
      isPushTurnPending = false
      return next(e)
    }
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
        isPushTurnPending = true
        void requestPhonePush($, message)
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
      void sendNotification(
        $,
        withPreview(
          `❓ "${project}". Claude is asking you something.`,
          firstQuestion,
          isPreviewIncluded,
        ),
      )
    })
    try {
      return await next(e)
    } finally {
      questionTimer.cancel()
    }
  })

  // The push turn is plumbing: shrink its prompt to one dim line and hide its tool
  // call, the result and the model's "ok". ctrl+o (expanded) still shows the prompt.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const isPushPrompt =
      e.props.origin.kind === 'plugin' && e.props.text.includes(PUSH_PROMPT_PREFIX)
    if (!isPushPrompt || e.props.isExpanded) return next(e)
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '🔔 push notification requested')
  })

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (e.props.tool !== PUSH_TOOL_NAME) return next(e)
    const { Box } = $.ui.resolve(e)
    return h(Box, { display: 'none' })
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.props.tool !== PUSH_TOOL_NAME) return next(e)
    const { Box } = $.ui.resolve(e)
    return h(Box, { display: 'none' })
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.props.text.trim() !== PUSH_REPLY) return next(e)
    const { Box } = $.ui.resolve(e)
    return h(Box, { display: 'none' })
  })
}
