# mod-notification

Get a push notification when Claude Code has finished or is waiting for you, so you can step away from the terminal without missing anything.

`mod-notification` is a [Claude Code](https://claude.com/claude-code) plugin. When a turn ends, or when Claude asks you a question, it starts a timer. If you haven't come back when the timer fires, it sends you a notification, on your phone too if Remote Control is connected.

## Features

- **Idle notification**: when a turn ends with an answer or an error and you haven't replied within the delay, you get a push notification.
- **Question alerts**: when Claude asks you something through `AskUserQuestion`, you get a desktop notification if you haven't answered within the delay.
- **Useful content**: each message shows the project name, the turn duration, token counts and the turn cost (costs under $0.01 are shown as `<$0.01`).
- **Optional preview**: append the last sentence of Claude's answer (truncated to 100 characters), which is usually the result or the question being asked.
- **Quiet when you're around**: the timer is cancelled as soon as you submit a prompt or end the session.
- **Clean display**: the internal push prompt, its tool call and the model's `ok` reply are hidden from the conversation.

## Installation

Clone the repository and start Claude Code with the plugin loaded:

```bash
git clone https://github.com/ouquoi/claude_mod_notification.git
claude --plugin-dir ./claude_mod_notification
```

For phone notifications, connect [Remote Control](https://code.claude.com/docs) to your session.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `delaySeconds` | number | `60` | How long to wait without any reply from you before a notification is sent. |
| `includePreview` | boolean | `true` | Append the end of Claude's answer (or the question itself) to the notification. |

## How it works

A mod can't send a phone push by itself. When the timer fires, it submits a prompt tagged `[mod-notification]` that asks the model to call the `PushNotification` tool with a prepared message, then reply `ok`. The mod then hides that exchange from the display.

## Development

The plugin is written in TypeScript. The hook module is `hooks/register.ts`, with tests in `hooks/register.test.ts`.

## License

[MIT](LICENSE) © 2026 ouquoi
