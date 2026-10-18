# mod-notification

Claude Code plugin (a "mod") that sends a notification when a turn ends or a question is asked and the user has not come back after a delay. See `README.md` for the user-facing description.

## Layout

- `.claude-plugin/plugin.json`: plugin manifest and user options (`delaySeconds`, `includePreview`).
- `hooks/hooks.json`: declares the mod module (`./register.ts`).
- `hooks/register.ts`: all the logic, a single `register` function exporting event handlers.
- `hooks/register.test.ts`: tests, using `claude-code/testing` (`mock.clock`, `$.turn.complete`).
- `tsconfig.json`: extends the config shipped with the plugin API types.

## How it works

- `turn.complete` (main loop only, reason `answer` or `error`) starts an idle timer; `turn.start`, `prompt.submit` and `session.end` cancel it.
- When the timer fires, the mod submits a prompt starting with `[mod-notification]` asking the model to call `PushNotification`. The mod cannot push to the phone itself.
- `isPushTurnPending` stops the push turn from scheduling another notification. Keep this guard when changing the flow.
- `tool.call` on `AskUserQuestion` starts its own timer, cancelled once the dialog is answered, and sends a desktop notification via `$.ui.notify`.
- `ui.render` handlers hide the push plumbing (prompt shrunk to one dim line, tool call, tool result, the model's `ok` reply). They match on `PUSH_PROMPT_PREFIX`, `PUSH_TOOL_NAME` and `PUSH_REPLY`, so keep those constants in sync with `buildPushPrompt`.

## Conventions

- TypeScript strict, no `any`.
- Errors are never swallowed: every `catch` logs through `$.ui.log` with the `mod-notification:` prefix.
- Constants at the top of `register.ts`; small pure helpers (`format*`, `to*`) above `register`.
- Every behavior change needs a test in `register.test.ts`.
- `README.md` and every other file in the repo are always written in English, even when the conversation is in French. Notification examples in the README must be in English too.
- Commit messages in English, format `type(scope): description`. No attribution lines.
