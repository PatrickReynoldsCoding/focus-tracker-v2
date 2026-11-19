# Connect Claude to your Focus Tracker

The tracker is its own MCP server at `https://<your-tracker>/mcp`. Claude can read everything and create, edit, move and delete projects, cards, columns, notes, lists, to-dos, habits, criteria, resources and sessions. Every change can be undone (Claude has an `undo` tool; the web app has an Undo button).

## Claude (web, desktop and mobile apps)

1. Settings → Connectors → **Add custom connector**.
2. Name: `Focus Tracker`. URL: `https://<your-tracker>/mcp`. Leave the OAuth fields empty.
3. Press Connect. A Focus Tracker page opens: type your password and press **Allow**.

Claude registers itself and gets a token that renews while it is used (it lapses after 30 days without use). To cut it off, press **Disconnect** in Settings → Claude and other connected apps. Changing the password does not disconnect Claude.

## Claude Code

With an API token from Settings → Devices and API tokens:

```sh
claude mcp add --transport http focus-tracker https://<your-tracker>/mcp --header "Authorization: Bearer ft_..."
```

## What to ask

- "What's on today?" (`get_today`, or `get_today_list` for the Today list: habits, to-dos and cards for today)
- "Add a card 'Fix login' to the Website project, in Doing."
- "Move everything in Done on the Garden board to a new column called Archive."
- "Write up these meeting notes into the notes of project X."
- "Make a to-do list for the weekend: ..."
- "Log 40 minutes on the novel: stopped at chapter 3, next is the dialogue pass."
- Modes: "... in work mode" (every tool takes `mode`).

Claude never picks the day's focus project on its own (each day starts empty until you choose), and never stores bank details, passwords or ID numbers.
