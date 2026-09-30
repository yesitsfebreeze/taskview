import { test, expect } from "claude-code/testing"
import { apply, bar, CAPACITY, reminder, rows, TOOL } from "./register.ts"
import type { TaskviewState } from "../types/index.d.ts"

const S = (tasks: TaskviewState["tasks"], nextId = tasks.length + 1): TaskviewState => ({ tasks, nextId })

test("bar: the percent centred across fill and trough, green when done", () => {
  expect(bar(0).map((s) => [s.text, s.backgroundColor])).toEqual([["    0%    ", "ansi256(18)"]])
  expect(bar(40).map((s) => [s.text, s.backgroundColor])).toEqual([
    ["   4", "ansi256(8)"],
    ["0%    ", "ansi256(18)"],
  ])
  expect(bar(100).map((s) => [s.text, s.backgroundColor])).toEqual([["   100%   ", "ansi256(8)"]])
  expect(bar(100, 10, true).map((s) => s.backgroundColor)).toEqual(["ansi256(2)"])
  expect(bar(100, 10, true)[0]?.text).toBe("   done   ")
})

test("add: five fit, the sixth warns and does not mutate", () => {
  let s = S([])
  for (let i = 1; i <= CAPACITY; i++) {
    const r = apply(s, { action: "add", title: `t${i}` })
    expect(r.warn).toBeUndefined()
    expect(r.state.tasks.length).toBe(i)
    expect(r.state.tasks[i - 1]?.id).toBe(i)
    s = r.state
  }
  const full = apply(s, { action: "add", title: "sixth" })
  expect(full.warn).toBe(true)
  expect(full.state).toBe(s)
  expect(full.text).toContain("full")
  expect(full.text).toContain("Tell the user")
})

test("progress walks a task to done; replace retires the old id; remove and clear", () => {
  let s = S([{ id: 1, title: "fix parser", progress: 0, status: "todo" }])
  s = apply(s, { action: "progress", id: 1, progress: 50 }).state
  expect(s.tasks[0]).toMatchObject({ progress: 50, status: "active" })
  s = apply(s, { action: "progress", id: 1, progress: 100 }).state
  expect(s.tasks[0]?.status).toBe("done")
  s = apply(s, { action: "progress", id: 1, progress: 30 }).state
  expect(s.tasks[0]).toMatchObject({ progress: 30, status: "active" })
  s = apply(s, { action: "complete", id: 1 }).state
  expect(s.tasks[0]?.progress).toBe(100)
  s = apply(s, { action: "add", title: "two" }).state
  s = apply(s, { action: "replace", id: 1, title: "renamed" }).state
  expect(s.tasks.map((t) => [t.id, t.title])).toEqual([[3, "renamed"], [2, "two"]])
  s = apply(s, { action: "remove", id: 2 }).state
  expect(s.tasks.length).toBe(1)
  expect(apply(s, { action: "progress", id: 99, progress: 1 }).warn).toBe(true)
  s = apply(s, { action: "clear" }).state
  expect(s.tasks).toEqual([])
})

test("rows: header, marker and bar beside each task, full warning at capacity", () => {
  const s = S([
    { id: 1, title: "fix the parser", progress: 45, status: "active" },
    { id: 2, title: "read the docs", progress: 100, status: "done" },
  ])
  const r = rows(s, 80)
  expect(r.length).toBe(3)
  expect(r[0]?.map((x) => x.text).join("")).toBe(" tasks 2/5 · 1 done")
  expect(r[1]?.map((x) => x.text).join("")).toBe(" ▶ #1 fix the parser    45%    ")
  expect(r[2]?.map((x) => x.text).join("")).toBe(" ✓ #2 read the docs    done   ")
  expect(rows(S([]), 80)).toEqual([])
  const full = rows(
    S(Array.from({ length: CAPACITY }, (_, i) => ({ id: i + 1, title: `t${i}`, progress: 0, status: "todo" }))),
    80,
  )
  expect(full[0]?.map((x) => x.text).join("")).toContain("⚠ full — replace a task to add another")
})

test("reminder: distil-when-empty, keep-current-when-set, loud when full", () => {
  expect(reminder(S([]))).toContain("you MUST first break the work into up to 5 tasks")
  expect(reminder(S([]))).toContain("For a question or chat that produces no files or changes, skip task creation")
  const set = reminder(S([{ id: 1, title: "write tests", progress: 60, status: "active" }]))
  expect(set).toContain('Tasks 1/5: #1 "write tests" 60% active')
  const full = reminder(
    S(Array.from({ length: CAPACITY }, (_, i) => ({ id: i + 1, title: `t${i}`, progress: 10, status: "todo" }))),
  )
  expect(full).toContain("FULL (5/5)")
})

test("the gate: an empty list refuses the first Write, a task list lets it pass", async ($, on) => {
  on("ui.render", async () => null as any)
  on("prompt.submit", async (_: any, e: any) => ({ ...e }))
  const denied = (await $.tool.call({ tool: "Write", file_path: "/tmp/x", content: "x" } as any)) as any
  expect(denied.deny).toContain("task list is empty")
  await $.tool.call({ tool: TOOL, action: "add", title: "the work" } as any)
  const reminderNow = await $.prompt.submit({ text: "go on" } as any)
  expect((reminderNow as any).context?.[0]).toContain('Tasks 1/5: #1 "the work" 0%')
})

test("the tool fills the view, the sixth warns, the band and the reminder follow", async ($, on) => {
  on("ui.render", async () => null as any)
  on("prompt.submit", async (_: any, e: any) => ({ ...e }))
  const band = async () =>
    JSON.stringify(await $.ui.render({ surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, bodyColumns: 80 } } as any))

  // No tasks yet: the band draws nothing, so nothing answers ui.render.
  expect((await band().catch((x: any) => String(x.message))).includes("no implementation")).toBe(true)
  const empty = await $.prompt.submit({ text: "build me a thing" } as any)
  expect(JSON.stringify(empty)).toContain("No tasks yet")

  const first = (await $.tool.call({ tool: TOOL, action: "add", title: "fix the parser" } as any)) as any
  expect(first.result).toContain('Added #1 "fix the parser" (1/5)')
  await $.tool.call({ tool: TOOL, action: "add", title: "read the docs" } as any)
  await $.tool.call({ tool: TOOL, action: "progress", id: 1, progress: 45 } as any)

  const tree = await band()
  for (const t of ["fix the parser", "read the docs"]) expect(tree).toContain(t)
  expect(tree).toContain("   45")
  expect(tree).toContain("%    ")
  expect(tree).toContain("2/5")

  const prompt = await $.prompt.submit({ text: "and now the tests" } as any)
  expect(JSON.stringify(prompt)).toContain("[taskview] Tasks 2/5")

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: TOOL, action: "add", title: `filler ${i}` } as any)
  const sixth = (await $.tool.call({ tool: TOOL, action: "add", title: "one too many" } as any)) as any
  expect(sixth.deny).toContain("full")
  expect(await band()).toContain("⚠ full — replace a task to add another")
})