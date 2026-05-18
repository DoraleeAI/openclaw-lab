# OpenClaw Lab

Node.js automation agent workspace for OpenClaw + GitHub + Notion + APIs.

## Purpose
- GitHub automation workflows
- Agent-based task execution
- API integrations (Notion, Places, ElevenLabs)

## Autonomous Dev Loop

`src/loop.js` watches issues labeled `automation` on this repo, hands each one
to a coding agent (`claude` if on PATH, otherwise a no-op stub), and opens a
PR for review.

### Run

```bash
npm run loop:dry     # list what would be picked, no side effects
npm run loop:once    # process one issue, then exit
npm run loop         # run forever (poll every POLL_SECONDS)
```

### Env

| Variable           | Default                    | Notes                                  |
|--------------------|----------------------------|----------------------------------------|
| `REPO`             | `DoraleeAI/openclaw-lab`   | `owner/name` of the watched repo       |
| `LABEL_TODO`       | `automation`               | Pick issues with this label            |
| `LABEL_INPROGRESS` | `in-progress`              | Added while a PR is being prepared     |
| `POLL_SECONDS`     | `60`                       | Sleep between ticks                    |
| `MAX_PRS_PER_HOUR` | `4`                        | Hard cap on PRs created per rolling hour |

### Install as a systemd user service

A template lives at `systemd/openclaw-lab.service`. After cloning to
`~/code/openclaw-lab` (or editing the unit), run:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/openclaw-lab.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openclaw-lab.service
journalctl --user -u openclaw-lab -f
```

The unit uses `Restart=on-failure` with a 5-restart burst limit so a flapping
process can't spam PRs or burn the GitHub rate limit.

## Status
Initial scaffold + autonomous loop (MVP).
