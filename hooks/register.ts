import type { Register, Timer } from "claude-code"
import type { TaskviewFinish, TaskviewState, TaskviewTask } from "../types/index.d.ts"

/** The registered tool's full name: `mcp__<plugin>__<name>`. */
export const TOOL = "mcp__taskview__task"
const STATE = { plugin: "taskview", key: "state" } as const
const FINISH = { plugin: "taskview", key: "finish" } as const
const EMPTY: TaskviewState = { tasks: [], nextId: 1 }
const FRESH: TaskviewFinish = { lastOpenSig: "", stalls: 0 }

// ── the finish signal ────────────────────────────────────────────────
// A stop with open tasks in the view is not finished work, so the session
// never rests on it: a stop without a finish reason (the **Done.** /
// **Partially done.** / **Failed.** status line of the task report) is
// resumed after RESUME_DELAY_MS of stop time by a prompt of its own; a finish
// reason with open tasks is continued now, to decide — ask the user or keep
// working. A stop that only waits on in-flight background work is left alone
// (it wakes on its own), and nothing continues after MAX_STALLS consecutive
// automatic continues leave the open tasks unchanged — a stall that deep
// needs the user, not another restart.

/** Stop time before a finish-reason-less stop resumes on its own. */
export const RESUME_DELAY_MS = 60_000
/** Consecutive automatic continues with unchanged open tasks before giving up. */
export const MAX_STALLS = 3
/** The status line of a finished task report. */
export const FINISH_REASON_RE = /\*\*(?:Done|Partially done|Failed)\.\*\*/

export type TaskInput = {
  action: "add" | "progress" | "complete" | "active" | "remove" | "replace" | "list" | "clear"
  id?: number
  title?: string
  progress?: number
}

/** One styled run of a row, as the terminal surface takes them. */
export type Seg = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean }

const clamp = (p: number) => Math.max(0, Math.min(100, Math.round(p)))

/**
 * The pure reducer every action goes through: returns the next state and the
 * text the model reads. `warn` marks a refused action — the state is unchanged.
 */
export const apply = (
  s: TaskviewState,
  i: TaskInput,
): { state: TaskviewState; text: string; warn?: boolean } => {
  const tasks = s.tasks.map((t) => ({ ...t }))
  const one = (id: number | undefined) => (id === undefined ? undefined : tasks.find((t) => t.id === id))
  switch (i.action) {
    case "add": {
      const title = (i.title ?? "").trim()
      if (!title) return { state: s, text: "add needs a title", warn: true }
      const t: TaskviewTask = { id: s.nextId, title, progress: 0, status: "todo" }
      tasks.push(t)
      return { state: { tasks, nextId: s.nextId + 1 }, text: `Added #${t.id} "${title}" (${tasks.length} tasks)` }
    }
    case "progress": {
      const t = one(i.id)
      if (!t) return { state: s, text: `no task #${i.id}`, warn: true }
      const p = clamp(i.progress ?? 0)
      t.progress = p
      t.status = p >= 100 ? "done" : p > 0 ? "active" : "todo"
      return { state: { tasks, nextId: s.nextId }, text: `#${t.id} "${t.title}" at ${p}%${t.status === "done" ? " — done" : ""}` }
    }
    case "complete": {
      const t = one(i.id)
      if (!t) return { state: s, text: `no task #${i.id}`, warn: true }
      t.progress = 100
      t.status = "done"
      const left = tasks.filter((x) => x.status !== "done").length
      return { state: { tasks, nextId: s.nextId }, text: `Completed #${t.id} "${t.title}"${left ? ` (${left} left)` : " — all tasks done"}` }
    }
    case "active": {
      const t = one(i.id)
      if (!t) return { state: s, text: `no task #${i.id}`, warn: true }
      for (const x of tasks) if (x.status === "active") x.status = "todo"
      if (t.status !== "done") t.status = "active"
      return { state: { tasks, nextId: s.nextId }, text: `Now working on #${t.id} "${t.title}"` }
    }
    case "remove": {
      const t = one(i.id)
      if (!t) return { state: s, text: `no task #${i.id}`, warn: true }
      return { state: { tasks: tasks.filter((x) => x.id !== t.id), nextId: s.nextId }, text: `Removed #${t.id} "${t.title}"` }
    }
    case "replace": {
      const t = one(i.id)
      const title = (i.title ?? "").trim()
      if (!t) return { state: s, text: `no task #${i.id}`, warn: true }
      if (!title) return { state: s, text: "replace needs the new title", warn: true }
      const fresh: TaskviewTask = { id: s.nextId, title, progress: 0, status: "todo" }
      const at = tasks.findIndex((x) => x.id === t.id)
      tasks[at] = fresh
      return {
        state: { tasks, nextId: s.nextId + 1 },
        text: `Replaced #${t.id} "${t.title}" with #${fresh.id} "${title}" (${tasks.length} tasks)`,
      }
    }
    case "clear":
      return { state: { tasks: [], nextId: s.nextId }, text: `Cleared ${s.tasks.length} task(s)` }
    case "list":
    default:
      return {
        state: s,
        text: s.tasks.length
          ? `${s.tasks.length} tasks, ${overall(s)}% overall: ` +
            s.tasks.map((t) => `#${t.id} "${t.title}" ${t.status === "done" ? "done" : `${t.progress}%`}`).join(" · ")
          : "no tasks",
      }
  }
}

/** tmux-sys's gauge, the followline one: `w` cells, the percent centred in it. */
export function bar(pct: number, w = 10, done = false): Seg[] {
  const p = clamp(pct)
  const t = done ? " done " : `${p}%`
  const l = Math.floor((w - t.length) / 2)
  const n = Math.round((p * w) / 100)
  const s = (" ".repeat(Math.max(0, l)) + t).padEnd(w)
  const fill = { color: "ansi256(0)", backgroundColor: `ansi256(${done ? 2 : 8})` } as const
  const trough = { color: "ansi256(8)", backgroundColor: "ansi256(18)" } as const
  return [
    { text: s.slice(0, n), ...fill },
    { text: s.slice(n), ...trough },
  ].filter((x) => x.text)
}

/** Overall progress: the mean over all tasks, a done task counting 100. */
export const overall = (s: TaskviewState): number =>
  s.tasks.length
    ? clamp(s.tasks.reduce((n, t) => n + (t.status === "done" ? 100 : clamp(t.progress)), 0) / s.tasks.length)
    : 0

/**
 * The band's rows: a header (the done count) and one row
 * per task — marker, the progress bar in front so the bars form one column,
 * then id and title.
 */
export function rows(s: TaskviewState, columns: number): Seg[][] {
  if (!s.tasks.length) return []
  const done = s.tasks.filter((t) => t.status === "done").length
  const head: Seg[] = [
    { text: ` tasks ${done}/${s.tasks.length} done`, dimColor: true },
  ]
  const out = [head]
  for (const t of s.tasks) {
    const mark: Seg =
      t.status === "done" ? { text: " ✓ ", color: "ansi256(2)" } : t.status === "active" ? { text: " ▶ ", color: "ansi256(3)" } : { text: " ○ ", dimColor: true }
    // bar (10) + marker (3) + " #nn " (~5) + padding: the title gets the rest.
    const budget = Math.max(8, columns - 20)
    const title = t.title.length > budget ? t.title.slice(0, budget - 1) + "…" : t.title
    out.push([
      mark,
      ...bar(t.progress, 10, t.status === "done"),
      { text: ` #${t.id} `, dimColor: true },
      { text: title, dimColor: t.status !== "active" },
    ])
  }
  return out
}

/**
 * The footer entry, right of the engine's own footer line: the overall bar
 * and the task count — it reads `40% of 15`. Empty with no tasks.
 */
export function footer(s: TaskviewState): Seg[] {
  if (!s.tasks.length) return []
  const done = s.tasks.every((t) => t.status === "done")
  return [...bar(overall(s), 10, done), { text: ` of ${s.tasks.length}`, dimColor: true }]
}

/** What the model reads beside every prompt so the view stays current. */
export function reminder(s: TaskviewState): string {
  if (!s.tasks.length)
    return `[taskview] No tasks yet. If this request involves creating, changing or fixing anything, you MUST first break the work into tasks with ${TOOL} — one {action:"add", title:"…"} call per task — BEFORE starting the work; then report progress (action "progress", id, progress 0-100) as you go and complete each task when done. For a question or chat that produces no files or changes, skip task creation. End finished work with the status line of the task report (**Done.** / **Partially done.** / **Failed.**): a stop with open tasks and no status line resumes the run on its own after a minute; a status line with tasks still open makes you either ask the user or keep working.`
  const list = s.tasks
    .map((t) => `#${t.id} "${t.title}" ${t.status === "done" ? "done" : `${t.progress}%${t.status === "active" ? " active" : ""}`}`)
    .join("; ")
  return `[taskview] ${s.tasks.length} task(s), ${overall(s)}% overall: ${list}. Keep this current with ${TOOL} (actions: add, progress, complete, active, remove, replace, list, clear); update progress as steps finish and complete tasks when done. End finished work with the status line of the task report (**Done.** / **Partially done.** / **Failed.**): a stop with open tasks and no status line resumes the run on its own after a minute; a status line with tasks still open makes you either ask the user or keep working.`
}

/** One open task as the finish signal's prompts list them. */
export const openTaskLines = (open: TaskviewTask[]): string =>
  open.map((t) => `  - #${t.id} "${t.title}" (${clamp(t.progress)}%)`).join("\n")

/** The open-task signature: a stop counts as stalled when it is unchanged. */
export const openSig = (s: TaskviewState): string =>
  JSON.stringify(s.tasks.filter((t) => t.status !== "done").map((t) => [t.id, t.title, t.progress]))

/** What the finish signal decides at a stop, and the bookkeeping it leaves. */
export type FinishVerdict =
  | { kind: "pass" } // nothing open — the stop stands
  | { kind: "resume"; open: TaskviewTask[] } // no finish reason: wake it after RESUME_DELAY_MS
  | { kind: "evaluate"; open: TaskviewTask[] } // finish reason with open tasks: continue now, decide
  | { kind: "stalled"; open: TaskviewTask[] } // cap hit: the stop stands, the user is told

/** The pure decision every stop goes through: the verdict plus the next bookkeeping. */
export const finishVerdict = (
  s: TaskviewState,
  lastAssistantMessage: string | undefined,
  f: TaskviewFinish,
): { verdict: FinishVerdict; next: TaskviewFinish } => {
  const open = s.tasks.filter((t) => t.status !== "done")
  if (!open.length) return { verdict: { kind: "pass" }, next: FRESH }
  const sig = openSig(s)
  const stalls = sig === f.lastOpenSig ? f.stalls + 1 : 0
  const next = { lastOpenSig: sig, stalls }
  if (stalls >= MAX_STALLS) return { verdict: { kind: "stalled", open }, next }
  if (FINISH_REASON_RE.test(lastAssistantMessage ?? "")) return { verdict: { kind: "evaluate", open }, next }
  return { verdict: { kind: "resume", open }, next }
}

/** The prompt that wakes a stop that had no finish reason. */
export const resumePrompt = (open: TaskviewTask[]): string =>
  `[taskview] The run stopped without a finish reason, but ${open.length} task(s) are still open:\n${openTaskLines(open)}\nContinue working them to completion with ${TOOL} (actions "progress", "complete"), and end with the standard task report and its status line (**Done.** / **Partially done.** / **Failed.**).`

/** The Stop-hook reason that continues a finish-reason stop with tasks open. */
export const evaluateReason = (open: TaskviewTask[]): string =>
  `taskview: finish reason reported, ${open.length} task(s) still open — decide: ask the user or continue`

/** The context the model reads with that reason. */
export const evaluateContext = (open: TaskviewTask[]): string =>
  `[taskview] You reported a finish reason, but ${open.length} task(s) are still open:\n${openTaskLines(open)}\nDecide whether you need user input to proceed. If you do, ask the user now — one question stating exactly what you need — and act on the answer. If you do not, continue working the open tasks to completion with ${TOOL} (actions "progress", "complete").`

/** Pending resumes by session id — one per session, cancelled when the person drives. */
const pending = new Map<string, Timer>()

export const register: Register = (on) => {
  // The tool the model drives the view with, live from turn one.
  on("session.start", async ($, e, next) => {
    // A fresh session: nothing to resume, no stall carried over.
    const sid = await $.session.id()
    pending.get(sid)?.cancel()
    pending.delete(sid)
    await $.state.set(FINISH, FRESH)
    await $.tool
      .register({
        name: "task",
        description:
          "The session's task view, drawn above the prompt. Distil the user's request into tasks automatically and keep them current while you work.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["add", "progress", "complete", "active", "remove", "replace", "list", "clear"],
              description: "add a task; report progress (id, progress 0-100); complete; mark active; remove; replace an old task with a new title (id, title); list; clear all",
            },
            id: { type: "number", description: "task id (everything but add and clear)" },
            title: { type: "string", description: "short task title (add, replace)" },
            progress: { type: "number", description: "0-100 (progress)" },
          },
          required: ["action"],
        },
      })
    await next(e)
  })

  // The finish signal: every settled stop is checked against the view. No
  // finish reason (no status line) and tasks open → the stop stands, and a
  // prompt of its own wakes it after RESUME_DELAY_MS; a finish reason with
  // tasks open → the stop is continued now to decide (ask the user or keep
  // working); nothing open → the stop stands and the bookkeeping is cleared.
  on("classic.Stop", async ($, e: any, next) => {
    const result = await next(e)
    // Paused, not stopped: in-flight background work or a scheduled cron
    // wakes the session on its own — a resume prompt here would only collide.
    if (e.background_tasks?.length || e.session_crons?.length) return result
    const sid = String(e.session_id)
    pending.get(sid)?.cancel()
    pending.delete(sid)
    const [{ value: s }, { value: f }] = await Promise.all([$.state.get(STATE), $.state.get(FINISH)])
    const { verdict, next: nf } = finishVerdict(s ?? EMPTY, e.last_assistant_message, f ?? FRESH)
    if (JSON.stringify(nf) !== JSON.stringify(f ?? FRESH)) await $.state.set(FINISH, nf)
    if (verdict.kind === "stalled") {
      $.ui.toast(
        `taskview: ${verdict.open.length} open task(s) unchanged after ${MAX_STALLS} automatic continues — needs your input`,
      )
      return result
    }
    if (verdict.kind === "pass") return result
    if (verdict.kind === "evaluate")
      return {
        block: evaluateReason(verdict.open),
        additionalContext: [evaluateContext(verdict.open)],
      }
    pending.set(
      sid,
      $.clock.after(RESUME_DELAY_MS, () => {
        pending.delete(sid)
        $.prompt.submit({ text: resumePrompt(verdict.open) }).catch(() => {})
      }),
    )
    return result
  })

  // Serve it: apply, persist, answer. The engine's mapper takes a string as
  // the result; `warn` answers as `deny` so the refusal reaches the model as an
  // error result — it then warns the user.
  on("tool.call", { tool: TOOL }, async ($, e: any, next) => {
    const s = (await $.state.get(STATE)).value ?? EMPTY
    const { state, text, warn } = apply(s, e as TaskInput)
    if (state !== s) await $.state.set(STATE, state)
    if (warn) return { deny: text }
    return { result: text }
  })

  // The teeth: with an empty task list, the first file-changing call is
  // refused until the work is on the list — the reminder steers, this makes
  // the automatic creation reliable. Read-only work and questions pass.
  const GATE = `taskview: the task list is empty. First break this work into tasks with ${TOOL} — one {action:"add", title:"…"} call per task, short titles — then retry this call. Read-only work and pure questions need no tasks.`
  for (const tool of ["Write", "Edit", "MultiEdit"])
    on("tool.call", { tool }, async ($, e, next) => {
      const s = (await $.state.get(STATE)).value ?? EMPTY
      if (s.tasks.length) return next(e)
      return { deny: GATE }
    })

  // The automatic half: every prompt carries the view, so the model creates
  // tasks from what the user asks for and keeps them current, unprompted.
  // A prompt also cancels any pending resume — the person is driving.
  on("prompt.submit", async ($, e: any, next) => {
    const sid = await $.session.id()
    pending.get(sid)?.cancel()
    pending.delete(sid)
    const s = (await $.state.get(STATE)).value ?? EMPTY
    return next({ ...e, context: [...(e.context ?? []), reminder(s)] })
  })

  // The view: the band above the prompt, one row per task, bar beside each.
  on("ui.render", { component: "AbovePrompt" }, async ($, e: any, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = (await $.state.get(STATE)).value ?? EMPTY
    const lines = rows(s, e.props.bodyColumns ?? 80)
    if (!lines.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      flexDirection: "column",
      children: lines.map((line) =>
        Text({ wrap: "truncate", children: line.map(({ text, ...style }) => Text({ ...style, children: text })) }),
      ),
    })
  })

  // The overall status: the engine's mode labels at the right of the prompt
  // footer, then the overall bar and the task count beside them.
  on("ui.render", { component: "SessionMode" }, async ($, e: any, next) => {
    const s = (await $.state.get(STATE)).value ?? EMPTY
    const segs = footer(s)
    if (!segs.length) return next(e)
    const { Text } = $.ui.resolve(e)
    const modes = (e.props.modes ?? []).join(" & ")
    return Text({
      wrap: "truncate",
      children: [...(modes ? [{ text: `${modes} `, dimColor: true }] : []), ...segs].map(({ text, ...style }) =>
        Text({ ...style, children: text }),
      ),
    })
  })
}