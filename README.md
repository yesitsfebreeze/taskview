# taskview

A task view over the session, for Claude Code and pi. The model distils what the
user asks for into tasks **on its own** — no `/task` command, no confirmation —
keeps their progress current while it works, and works them to completion. The
list draws above the prompt with a progress bar beside each task. It holds at
most **5 tasks**; past that, the model is refused with a warning it must pass on
to the user, and an old task has to be **replaced** (`action: "replace"`) before
a new one fits.

## How it behaves

- **Automatic creation — enforced.** The user sends a prompt describing work;
  the model breaks it into up to 5 tasks through the task tool and starts. Two
  mechanisms make this reliable, not hoped-for: an imperative reminder rides
  every prompt ("you MUST first break the work into tasks… BEFORE starting the
  work; skip for questions that change nothing"), and a **gate** refuses the
  first file-changing call (`Write`/`Edit` — `write`/`edit` in pi) with
  instructions while the list is empty, so the work cannot start untracked.
  Follow-up prompts refine the same session: tasks can be added, progressed,
  completed, replaced or removed at any time. Pure questions create no tasks.
- **The view.** One band above the prompt: a header (`2/5 · 1 done`), one row
  per task — `✓` done, `▶` active, `○` todo — and a progress bar (the percent
  centred in it) beside each task.
- **Capacity.** At 5/5 an `add` answers with an error result ("tell the user
  the list is full"), the header shows `⚠ full — replace a task to add another`,
  and in pi a warning notification fires. `replace` retires an old task and
  issues a fresh id.
- **Progress.** `progress` (id, 0–100) walks a task along; `complete` finishes
  it; `active` marks the one being worked. 100% is done.

## The tool

`task` / `mcp__taskview__task` — one call per change:

| action | takes | does |
|---|---|---|
| `add` | `title` | new task at 0% (refused when full) |
| `progress` | `id`, `progress` 0–100 | sets the bar, `done` at 100 |
| `complete` | `id` | 100%, done |
| `active` | `id` | the task now being worked |
| `remove` | `id` | drops a task |
| `replace` | `id`, `title` | retires the old task for a new one — the full-list escape hatch |
| `list` / `clear` | | the list / empty it |

## Install

**Claude Code** — this repo is a local marketplace:

```
claude plugin marketplace add ~/dev/claude-plugins/taskview
claude plugin install taskview@taskview --scope user
```

Checks: `claude plugin validate .` and `claude plugin test .` (the suite drives
the reducer, the capacity warning, the band and the per-prompt reminder end to
end).

**pi** — copy the port to the extensions folder and start pi:

```
cp install/pi/extension.ts ~/.pi/agent/extensions/taskview.ts
```

The pi half is one standalone file: same reducer, same capacity law, the band
drawn as an editor widget (`ctx.ui.setWidget`, `aboveEditor` placement). State
follows the session branch — the whole list rides in every tool result's
`details` and is reconstructed on `session_start`/`session_tree`. A
`before_agent_start` guideline tells the model to create and keep tasks on its
own; `/tasks` prints the list.

## Files

- `hooks/register.ts` — the Claude Code plugin: the registered tool, the
  per-prompt reminder that drives automatic creation, and the `AbovePrompt`
  band with the bars.
- `hooks/register.test.ts` — reducer, gauge, band and integration tests.
- `install/pi/extension.ts` — the pi port.
- `types/index.d.ts` — the plugin state shape (`$.state`).