# pi-cook

Disclaimer: Extension written fully by Pi itself.

Cook mode for the
[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent.
Like the "cook mode" toggle on recipe sites: keeps your screen from locking or
sleeping, so you can watch the agent work from across the room.

## Install

```bash
pi install npm:@grammeaway/pi-cook
```

To try it without permanently installing:

```bash
pi -e npm:@grammeaway/pi-cook
```

## Usage

| Command       | Effect                                           |
| ------------- | ------------------------------------------------ |
| `/cook`       | Toggle on/off                                    |
| `/cook on`    | Screen stays awake while this session is open    |
| `/cook agent` | Screen stays awake only while the agent works    |
| `/cook off`   | Back to normal                                   |

`/cook` runs instantly, even mid-response, without interrupting the agent.
The footer shows `♨ cook` or `♨ cook (agent)` while active.

## Notes

- **Per session.** The mode is stored in the session file, so resuming a
  session restores it, and other Pi sessions are unaffected. A session started
  with `/new` or `/fork` (or by an extension) keeps the mode of the one it
  replaced.
- **Linux:** `systemd-inhibit --what=idle`. Respected by GNOME, KDE, and
  hypridle (default `ignore_systemd_inhibit = false`).
- **macOS:** `caffeinate -d -i`.
- **Windows / non-systemd Linux:** not supported; `/cook` says so.
- The inhibitor watches Pi's PID, so a crashed Pi never leaves a lock behind.
  If the inhibitor itself dies, cook mode turns off and tells you.
- Custom footers that don't render `ctx.ui.setStatus` can read
  `globalThis.__piCookMode` (the label, or `""` when off).

## Development

```bash
npm install
npm test   # unit, property-based (fast-check), and a real systemd-inhibit check on Linux
```
