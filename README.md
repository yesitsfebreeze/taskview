# taskview

A task view over the session, for Claude Code and pi. The model distils what the
user asks for into tasks **on its own** — no `/task` command, no confirmation —
keeps their progress current while it works, and works them to completion. The
list draws above the prompt with a progress bar in front of each task, and the
overall progress sits in the footer. There is **no task limit**.

## How it behaves

- **Automatic creation — enforced.** The user sends a prompt describing work;
  the model breaks it into tasks through the task tool and starts. Two
  mechanisms make this reliable, not hoped-for: an imperative reminder rides
  every prompt ("you MUST first break the work into tasks… BEFORE starting the
  work; skip for questions that change nothing"), and a **gate** refuses the
  first file-changing call (`Write`/`Edit` — `write`/`edit` in pi) with
  instructions while the list is empty, so the work cannot start untracked.
  Follow-up prompts refine the same session: tasks can be added, progressed,
  completed, replaced or removed at any time. Pure questions create no tasks.
- **The view.** One band above the prompt: a header (`tasks 1/2 done`), one
  row per task — `✓` done, `▶` active, `○` todo — with the progress bar (the
  percent centred in it) in front of the title, so the bars form one column
  and the whole status reads at a glance.
- **Overall progress.** A bar at the right of the prompt footer, beside the
  engine's own mode labels (pi: the footer status): the mean progress over all
  tasks and the task count — `40% of 15`.
- **No limit.** Any number of tasks fits. `replace` retires an old task and
  issues a fresh id.
- **Progress.** `progress` (id, 0–100) walks a task along; `complete` finishes
  it; `active` marks the one being worked. 100% is done.
- **The finish signal.** A stop with open tasks in the view is not finished
  work, so the session never rests on it. The model ends finished work with
  the task report's status line — `**Done.**` / `**Partially done.**` /
  `**Failed.**` — and every stop is checked against it:
  - **No status line, tasks open** — the stop stands, and after a minute of
    stop time a prompt of its own resumes the run: the open tasks listed,
    "continue working them to completion".
  - **Status line, tasks open** — the run continues now to decide: ask the
    user (the answer box opens — `ask` in pi, `AskUserQuestion` in Claude
    Code) or keep working.
  - Nothing fires while background work is in flight or a cron is scheduled
    (Claude Code: the session wakes on its own), on a user-aborted or errored
    run (pi: an explicit stop outranks the signal), or after **3 consecutive
    automatic continues leave the open tasks unchanged** — a stall that deep
    is told to the user instead of looping again. Any progress on any open
    task makes the next stop a fresh one.
  - The person always stays in front: submitting anything cancels a pending
    resume (pi: any new run does; Claude Code: `prompt.submit` does).

## The tool

`task` / `mcp__taskview__task` — one call per change:

| action | takes | does |
|---|---|---|
| `add` | `title` | new task at 0% |
| `progress` | `id`, `progress` 0–100 | sets the bar, `done` at 100 |
| `complete` | `id` | 100%, done |
| `active` | `id` | the task now being worked |
| `remove` | `id` | drops a task |
| `replace` | `id`, `title` | retires the old task for a new one |
| `list` / `clear` | | the list / empty it |

## Install

**Claude Code** — this repo is a local marketplace:

```
claude plugin marketplace add ~/dev/claude-plugins/taskview
claude plugin install taskview@taskview --scope user
```

Checks: `claude plugin validate .` and `claude plugin test .` (the suite drives
the reducer, the band, the footer bar and the per-prompt reminder end to
end).

**pi** — copy the port to the extensions folder and start pi:

```
cp install/pi/extension.ts ~/.pi/agent/extensions/taskview.ts
```

The pi half is one standalone file: same reducer, the band
drawn as an editor widget (`ctx.ui.setWidget`, `aboveEditor` placement). State
follows the session branch — the whole list rides in every tool result's
`details` and is reconstructed on `session_start`/`session_tree`. A
`before_agent_start` guideline tells the model to create and keep tasks on its
own; `/tasks` prints the list.

## Files

- `hooks/register.ts` — the Claude Code plugin: the registered tool, the
  per-prompt reminder that drives automatic creation, and the `AbovePrompt`
  band with the bars and the `SessionMode` footer bar.
- `hooks/register.test.ts` — reducer, gauge, band and integration tests.
- `install/pi/extension.ts` — the pi port.
- `types/index.d.ts` — the plugin state shape (`$.state`).

## Codex support

The same plugin repository now includes `.codex-plugin/plugin.json` and a
Codex adapter under `install/codex/`. Claude Code keeps using its existing
manifest and hooks. See [Codex setup](install/codex/README.md).
