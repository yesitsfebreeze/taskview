import type { Register } from "claude-code"
import type { TaskviewState, TaskviewTask } from "../types/index.d.ts"

/** The view holds at most this many tasks; the next add must replace one. */
export const CAPACITY = 5
/** The registered tool's full name: `mcp__<plugin>__<name>`. */
export const TOOL = "mcp__taskview__task"
const STATE = { plugin: "taskview", key: "state" } as const
const EMPTY: TaskviewState = { tasks: [], nextId: 1 }

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
 * text the model reads. `warn` marks the capacity refusal — the add was NOT
 * made, the model must tell the user an old task has to make room.
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
      if (tasks.length >= CAPACITY)
        return {
          state: s,
          warn: true,
          text: `WARNING: the task view is full (${CAPACITY}/${CAPACITY}) — "${title}" was NOT added. Tell the user the list is full and an old task must make room: either call action "replace" with the id of the task to retire, or complete/remove one first.`,
        }
      const t: TaskviewTask = { id: s.nextId, title, progress: 0, status: "todo" }
      tasks.push(t)
      return { state: { tasks, nextId: s.nextId + 1 }, text: `Added #${t.id} "${title}" (${tasks.length}/${CAPACITY})` }
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
        text: `Replaced #${t.id} "${t.title}" with #${fresh.id} "${title}" (${tasks.length}/${CAPACITY})`,
      }
    }
    case "clear":
      return { state: { tasks: [], nextId: s.nextId }, text: `Cleared ${s.tasks.length} task(s)` }
    case "list":
    default:
      return {
        state: s,
        text: s.tasks.length
          ? `${s.tasks.length}/${CAPACITY}: ` +
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

/**
 * The band's rows: a header (`n/5`, done count, the full warning) and one row
 * per task — marker, id, title, then the progress bar beside it.
 */
export function rows(s: TaskviewState, columns: number): Seg[][] {
  if (!s.tasks.length) return []
  const done = s.tasks.filter((t) => t.status === "done").length
  const head: Seg[] = [
    { text: " tasks ", dimColor: true },
    { text: `${s.tasks.length}/${CAPACITY}`, color: s.tasks.length >= CAPACITY ? "ansi256(3)" : "ansi256(8)" },
    { text: done ? ` · ${done} done` : "", dimColor: true },
  ].filter((x) => x.text)
  if (s.tasks.length >= CAPACITY)
    head.push({ text: " ⚠ full — replace a task to add another", color: "ansi256(3)" })
  const out = [head]
  for (const t of s.tasks) {
    const mark: Seg =
      t.status === "done" ? { text: " ✓ ", color: "ansi256(2)" } : t.status === "active" ? { text: " ▶ ", color: "ansi256(3)" } : { text: " ○ ", dimColor: true }
    // bar (10) + marker (3) + " #nn " (~5) + padding: the title gets the rest.
    const budget = Math.max(8, columns - 20)
    const title = t.title.length > budget ? t.title.slice(0, budget - 1) + "…" : t.title
    out.push([
      mark,
      { text: `#${t.id} `, dimColor: true },
      { text: title, dimColor: t.status !== "active" },
      { text: " " },
      ...bar(t.progress, 10, t.status === "done"),
    ])
  }
  return out
}

/** What the model reads beside every prompt so the view stays current. */
export function reminder(s: TaskviewState): string {
  if (!s.tasks.length)
    return `[taskview] No tasks yet. If the user's request describes concrete work, distill it into up to ${CAPACITY} tasks now — one ${TOOL} call per task with {action:"add",title}, no need to ask. Then keep progress current as you work.`
  const list = s.tasks
    .map((t) => `#${t.id} "${t.title}" ${t.status === "done" ? "done" : `${t.progress}%${t.status === "active" ? " active" : ""}`}`)
    .join("; ")
  const full =
    s.tasks.length >= CAPACITY
      ? ` The list is FULL (${CAPACITY}/${CAPACITY}): a new task needs an old one replaced (action "replace") or removed — tell the user.`
      : ""
  return `[taskview] Tasks ${s.tasks.length}/${CAPACITY}: ${list}. Keep this current with ${TOOL} (actions: add, progress, complete, active, remove, replace, list, clear); update progress as steps finish and complete tasks when done.${full}`
}

export const register: Register = (on) => {
  // The tool the model drives the view with, live from turn one.
  on("session.start", ($, e, next) =>
    $.tool
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
      .then(() => next(e)),
  )

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

  // The automatic half: every prompt carries the view, so the model creates
  // tasks from what the user asks for and keeps them current, unprompted.
  on("prompt.submit", async ($, e: any, next) => {
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
}