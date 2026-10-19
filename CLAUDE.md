# mod-notification

Claude Code plugin (a "mod") that sends a notification when a turn ends or a question is asked and the user has not come back after a delay. See `README.md` for the user-facing description.

## Layout

- `.claude-plugin/plugin.json`: plugin manifest and user options (`delaySeconds`, `ntfyTopic`, `includePreview`).
- `hooks/hooks.json`: declares the mod module (`./register.ts`).
- `hooks/register.ts`: all the logic, a single `register` function exporting event handlers.
- `hooks/register.test.ts`: tests, using `claude-code/testing` (`mock.clock`, `$.turn.complete`).
- `tsconfig.json`: extends the config shipped with the plugin API types.

## How it works

- `turn.complete` (main loop only, reason `answer` or `error`) starts an idle timer; `turn.start`, `prompt.submit` and `session.end` cancel it.
- When a timer fires, `alertPerson` sends a desktop notification (`$.ui.notify`) and, if `ntfyTopic` is set, a phone push to ntfy (`$.http.fetch`, JSON body so emoji and accents survive). No model turn is involved, so it costs no tokens.
- `tool.call` on `AskUserQuestion` starts its own timer, cancelled once the dialog is answered, and ends in the same `alertPerson`.
- Dead ends, do not retry: a prompt submitted with `$.prompt.submit` queues behind the running turn, so it cannot alert during an open question and it costs tokens; `$.tool.call` on `PushNotification` answers "Mobile push requested" but nothing reaches the phone.
- The module loader only lets `$` be passed to functions declared at the top level of `register.ts`, never to closures inside `register`.
- Claude Code loads the mod from the copy in `~/.claude/mods/mod-notification`, not from this folder: copy `hooks/register.ts` and `.claude-plugin/plugin.json` there to try a change in a session.

## Conventions

- TypeScript strict, no `any`.
- Errors are never swallowed: every `catch` logs through `$.ui.log` with the `mod-notification:` prefix.
- Constants at the top of `register.ts`; small pure helpers (`format*`, `to*`) above `register`.
- Every behavior change needs a test in `register.test.ts`.
- `README.md` and every other file in the repo are always written in English, even when the conversation is in French. Notification examples in the README must be in English too.
- Commit messages in English, format `type(scope): description`. No attribution lines.
