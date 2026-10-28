/** One task in the session's task view. */
export type TaskviewTask = {
  /** Stable number; `replace` retires the old id and issues the next one. */
  id: number
  /** What the model distilled from the user's request, short. */
  title: string
  /** 0–100, the fill of the bar drawn beside the task. */
  progress: number
  /** `done` at 100, `active` while being worked, `todo` until first touched. */
  status: "todo" | "active" | "done"
}

/** The whole task view: any number of tasks. */
export type TaskviewState = {
  tasks: TaskviewTask[]
  nextId: number
}

/** The finish signal's bookkeeping at a stop: what it compares the next stop against. */
export type TaskviewFinish = {
  /** The open-task signature at the last acted-on stop; `""` when none yet. */
  lastOpenSig: string
  /** Consecutive automatic continues with the open tasks unchanged. */
  stalls: number
}

declare module "claude-code" {
  interface PluginState {
    taskview: { state: TaskviewState; finish: TaskviewFinish }
  }
}