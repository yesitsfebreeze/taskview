import { test, expect } from "claude-code/testing"
import {
  apply,
  bar,
  evaluateContext,
  evaluateReason,
  finishVerdict,
  footer,
  MAX_STALLS,
  openSig,
  reminder,
  resumePrompt,
  rows,
  TOOL,
} from "./register.ts"
import type { TaskviewFinish, TaskviewState } from "../types/index.d.ts"

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

test("add: no limit — every add fits", () => {
  let s = S([])
  for (let i = 1; i <= 15; i++) {
    const r = apply(s, { action: "add", title: `t${i}` })
    expect(r.warn).toBeUndefined()
    expect(r.state.tasks.length).toBe(i)
    expect(r.state.tasks[i - 1]?.id).toBe(i)
    s = r.state
  }
  expect(apply(s, { action: "add", title: " " }).warn).toBe(true)
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

test("rows: header, then marker and bar in front of each task; footer: overall bar and count", () => {
  const s = S([
    { id: 1, title: "fix the parser", progress: 45, status: "active" },
    { id: 2, title: "read the docs", progress: 100, status: "done" },
  ])
  const r = rows(s, 80)
  expect(r.length).toBe(3)
  expect(r[0]?.map((x) => x.text).join("")).toBe(" tasks 1/2 done")
  expect(r[1]?.map((x) => x.text).join("")).toBe(" ▶    45%     #1 fix the parser")
  expect(r[2]?.map((x) => x.text).join("")).toBe(" ✓    done    #2 read the docs")
  expect(rows(S([]), 80)).toEqual([])
  // (45 + 100) / 2 = 72.5, rounded up.
  expect(footer(s).map((x) => x.text).join("")).toBe("   73%     of 2")
  expect(footer(S([s.tasks[1]!])).map((x) => x.text).join("")).toBe("   done    of 1")
  expect(footer(S([]))).toEqual([])
})

test("reminder: distil-when-empty, keep-current-when-set", () => {
  expect(reminder(S([]))).toContain("you MUST first break the work into tasks")
  expect(reminder(S([]))).toContain("For a question or chat that produces no files or changes, skip task creation")
  const set = reminder(S([{ id: 1, title: "write tests", progress: 60, status: "active" }]))
  expect(set).toContain('1 task(s), 60% overall: #1 "write tests" 60% active')
})

test("the gate: an empty list refuses the first Write, a task list lets it pass", async ($, on) => {
  on("ui.render", async () => null as any)
  on("prompt.submit", async (_: any, e: any) => ({ ...e }))
  on("session.id", async () => ({ value: "s1" }))
  const denied = (await $.tool.call({ tool: "Write", file_path: "/tmp/x", content: "x" } as any)) as any
  expect(denied.deny).toContain("task list is empty")
  await $.tool.call({ tool: TOOL, action: "add", title: "the work" } as any)
  const reminderNow = await $.prompt.submit({ text: "go on" } as any)
  expect((reminderNow as any).context?.[0]).toContain('1 task(s), 0% overall: #1 "the work" 0%')
})

test("the tool fills the view past five, the band, the footer and the reminder follow", async ($, on) => {
  on("ui.render", async () => null as any)
  on("prompt.submit", async (_: any, e: any) => ({ ...e }))
  on("session.id", async () => ({ value: "s1" }))
  const band = async () =>
    JSON.stringify(await $.ui.render({ surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, bodyColumns: 80 } } as any))

  // No tasks yet: the band draws nothing, so nothing answers ui.render.
  expect((await band().catch((x: any) => String(x.message))).includes("no implementation")).toBe(true)
  const empty = await $.prompt.submit({ text: "build me a thing" } as any)
  expect(JSON.stringify(empty)).toContain("No tasks yet")

  const first = (await $.tool.call({ tool: TOOL, action: "add", title: "fix the parser" } as any)) as any
  expect(first.result).toContain('Added #1 "fix the parser" (1 tasks)')
  await $.tool.call({ tool: TOOL, action: "add", title: "read the docs" } as any)
  await $.tool.call({ tool: TOOL, action: "progress", id: 1, progress: 45 } as any)

  const tree = await band()
  for (const t of ["fix the parser", "read the docs"]) expect(tree).toContain(t)
  expect(tree).toContain("   45")
  expect(tree).toContain("%    ")
  expect(tree).toContain("tasks 0/2 done")
  const foot = JSON.stringify(
    await $.ui.render({ surface: "terminal", component: "SessionMode", props: { modes: ["focus"] } } as any),
  )
  for (const t of ["focus ", "23%", " of 2"]) expect(foot).toContain(t)

  const prompt = await $.prompt.submit({ text: "and now the tests" } as any)
  expect(JSON.stringify(prompt)).toContain("[taskview] 2 task(s), 23% overall")

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: TOOL, action: "add", title: `filler ${i}` } as any)
  const sixth = (await $.tool.call({ tool: TOOL, action: "add", title: "one too many" } as any)) as any
  expect(sixth.result).toContain("(6 tasks)")
  expect(await band()).toContain("one too many")
})
const OPEN = S([{ id: 1, title: "fix the parser", progress: 45, status: "active" }])
const DONE = S([{ id: 1, title: "fix the parser", progress: 100, status: "done" }])
const F0: TaskviewFinish = { lastOpenSig: "", stalls: 0 }

test("openSig: the open tasks, not the done ones; progress changes it", () => {
  expect(openSig(DONE)).toBe("[]")
  expect(openSig(OPEN)).toBe(JSON.stringify([[1, "fix the parser", 45]]))
  const moved = S([{ id: 1, title: "fix the parser", progress: 60, status: "active" }])
  expect(openSig(moved)).not.toBe(openSig(OPEN))
})

test("finishVerdict: nothing open passes and clears the bookkeeping", () => {
  const r = finishVerdict(DONE, "no status line anywhere", { lastOpenSig: "x", stalls: 2 })
  expect(r.verdict.kind).toBe("pass")
  expect(r.next).toEqual(F0)
})

test("finishVerdict: open tasks and no status line resume; a status line evaluates", () => {
  const resume = finishVerdict(OPEN, "I stopped mid-work, will continue later", F0)
  expect(resume.verdict).toEqual({ kind: "resume", open: OPEN.tasks })
  expect(resume.next.lastOpenSig).toBe(openSig(OPEN))
  expect(resume.next.stalls).toBe(0)
  const evaluate = finishVerdict(OPEN, "> the request\n\n**Done.** shipped it", F0)
  expect(evaluate.verdict).toEqual({ kind: "evaluate", open: OPEN.tasks })
  for (const status of ["**Done.**", "**Partially done.** x", "y **Failed.**"]) {
    const r = finishVerdict(OPEN, status, F0)
    expect(r.verdict.kind).toBe("evaluate")
  }
})

test("finishVerdict: unchanged open tasks stall toward the cap, progress resets it", () => {
  const sig = openSig(OPEN)
  const s1 = finishVerdict(OPEN, "stopped", { lastOpenSig: sig, stalls: 1 })
  expect(s1.verdict.kind).toBe("resume")
  expect(s1.next.stalls).toBe(2)
  const s2 = finishVerdict(OPEN, "stopped again", s1.next)
  expect(s2.verdict).toEqual({ kind: "stalled", open: OPEN.tasks })
  expect(s2.next.stalls).toBe(3)
  const stillStalled = finishVerdict(OPEN, "stopped once more", s2.next)
  expect(stillStalled.verdict.kind).toBe("stalled")
  // Progress on any open task makes the next stop a fresh one.
  const moved = S([{ id: 1, title: "fix the parser", progress: 60, status: "active" }])
  const fresh = finishVerdict(moved, "stopped", stillStalled.next)
  expect(fresh.verdict.kind).toBe("resume")
  expect(fresh.next).toEqual({ lastOpenSig: openSig(moved), stalls: 0 })
  expect(MAX_STALLS).toBe(3)
})

test("the finish signal's messages name the open tasks and what to do", () => {
  const open = OPEN.tasks
  expect(resumePrompt(open)).toContain("stopped without a finish reason, but 1 task(s) are still open")
  expect(resumePrompt(open)).toContain('  - #1 "fix the parser" (45%)')
  expect(resumePrompt(open)).toContain("**Done.**")
  expect(evaluateReason(open)).toContain("1 task(s) still open")
  expect(evaluateContext(open)).toContain("Decide whether you need user input")
  expect(evaluateContext(open)).toContain(TOOL)
})

test("reminder: the finish signal's status-line contract rides every prompt", () => {
  expect(reminder(S([]))).toContain("End finished work with the status line")
  expect(reminder(S([]))).toContain("resumes the run on its own after a minute")
})
