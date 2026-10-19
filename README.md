# mod-notification

Get a desktop and phone notification when Claude Code has finished or is waiting for you, so you can step away from the terminal without missing anything.

`mod-notification` is a [Claude Code](https://claude.com/claude-code) plugin. When a turn ends, or when Claude asks you a question, it starts a timer. If you haven't come back when the timer fires, it sends you a notification on your desktop and, through [ntfy](https://ntfy.sh), on your phone. It never asks the model to do anything, so it costs no tokens.

## Features

- **Idle notification**: when a turn ends with an answer or an error and you haven't replied within the delay, you get a notification.
- **Question alerts**: when Claude asks you something through `AskUserQuestion`, you get a desktop notification and a phone push if you haven't answered within the delay.
- **Useful content**: each message shows the project name, the turn duration, token counts and the turn cost (costs under $0.01 are shown as `<$0.01`).
- **Optional preview**: append the last sentence of Claude's answer (truncated to 100 characters), which is usually the result or the question being asked.
- **Quiet when you're around**: the timer is cancelled as soon as you submit a prompt or end the session.
- **Open button**: the phone notification carries an "Open Claude Code" button, and tapping the notification does the same. It opens `https://claude.ai/code` (your session list), because a mod cannot read its own session's address.
- **No tokens**: the phone push is a plain HTTP request to ntfy, not a model turn, so nothing is added to the conversation.

## Notification examples

Every notification reads the same on the desktop and on the phone. Turn finished, with the preview on (default):

```
✅ "my-project" · 17s · 219.4k in / 1.7k out · $0.06. Claude is waiting for you. « Do you want me to push it? »
```

Turn finished, with the preview off:

```
✅ "my-project" · 1m 12s · 48.2k in / 3.1k out · $0.21. Claude is waiting for you.
```

Turn stopped on an error:

```
❌ "my-project" · 9s · 12.0k in / 350 out · <$0.01. Claude stopped on an error. « The build failed on the auth tests. »
```

Claude is asking you a question:

```
❓ "my-project". Claude is asking you something. « Which package manager should we use? »
```

The project name is the last folder of the session's working directory. Token counts include cached tokens.

## Installation

Clone the repository and start Claude Code with the plugin loaded:

```bash
git clone https://github.com/ouquoi/claude_mod_notification.git
claude --plugin-dir ./claude_mod_notification
```

### Phone notifications

1. Install the [ntfy app](https://ntfy.sh) on your phone.
2. Subscribe to a topic with a long random name, for example `claude-mod-4f9a1c7e2b8d`. Anyone who knows the topic name can read your notifications, so treat it as a secret.
3. Set the `ntfyTopic` option to that name (see below).

Without `ntfyTopic`, only the desktop notification is sent, and a line in the debug log says so.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `delaySeconds` | number | `60` | How long to wait without any reply from you before a notification is sent. |
| `ntfyTopic` | string | empty | Secret ntfy topic the phone push is sent to. Empty means no phone push. |
| `includePreview` | boolean | `true` | Append the end of Claude's answer (or the question itself) to the notification. |

## How it works

When the timer fires, the mod raises a desktop notification through Claude Code's notification channel (the `preferredNotifChannel` setting; on Windows, `terminal_bell` is the most reliable) and posts the same text to `https://ntfy.sh` with `$.http.fetch`. The text, including the question or the end of the answer when the preview is on, therefore goes through the ntfy server.

## Why an external tool like ntfy?

Claude Code can push to your phone through its `PushNotification` tool (via Remote Control), but that tool belongs to the model, and a mod has no supported way to make it reach the phone on its own. Two approaches were tried and dropped:

- **Asking the model to call the tool.** The mod submits a prompt and the model calls `PushNotification`. This works at the end of a turn, but every push is a model turn that costs tokens. It also cannot alert you about a question: the prompt queues behind the running turn, so it only runs after you have answered the dialog, which is too late.
- **Calling the tool directly from the mod.** `$.tool.call` on `PushNotification` answers "Mobile push requested", but in testing nothing reached the phone. The push appears to depend on the tool call being part of the conversation stream sent to Remote Control, which a direct call from a mod bypasses.

The desktop notification is not enough on its own either: it only writes to your terminal (`preferredNotifChannel`), so it never reaches a phone, and on Windows it often shows nothing at all.

[ntfy](https://ntfy.sh) solves both problems. The mod sends a plain HTTP request, so there is no model turn and no tokens. It also works while a question dialog is open, because nothing has to wait for the turn. The cost is a third-party service that sees the notification text, which is why the topic name must stay secret.

## Development

The plugin is written in TypeScript. The hook module is `hooks/register.ts`, with tests in `hooks/register.test.ts`.

## License

[MIT](LICENSE) © 2026 ouquoi
