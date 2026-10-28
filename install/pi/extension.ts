/**
 * taskview for pi — the session's task view, drawn above the status bar.
 *
 * The Claude Code twin is the repo's `hooks/register.ts`; this is the pi port,
 * one file so it installs standalone as `~/.pi/agent/extensions/taskview.ts`.
 *
 * - Registers a `task` tool: the model distils the user's requests into
 *   tasks on its own (the before_agent_start guideline below tells it to),
 *   keeps progress current while it works, and works tasks to completion.
 * - Draws the list as a widget above the editor: one row per task, the
 *   progress bar in front of each, the done count in a header. There is no
 *   task limit.
 * - Pins the overall progress in the footer status: a bar and `40% of 15`.
 * - The finish signal: a settled stop with open tasks never rests — no
 *   finish reason (no **Done.** / **Partially done.** / **Failed.** status
 *   line) resumes the run after a minute of stop time; a finish reason with
 *   open tasks steers the run to either ask the user (the ask tool opens the
 *   answer box) or keep working. Aborted runs and unchanged-task stalls stop
 *   the signal: the first is the user's explicit stop, the second needs them.
 *
 * State follows the branch: the whole task list rides in every tool result's
 * `details` and is reconstructed from the branch on session_start/session_tree.
 */

import { StringEnum, type AssistantMessage, type TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

// ── the finish signal ──────────────────────────────────────────────────────
// A stop with open tasks in the view is not finished work, so the session
// never rests on it: a stop without a finish reason (the **Done.** /
// **Partially done.** / **Failed.** status line of the task report) resumes the
// run after RESUME_DELAY_MS of stop time; a finish reason with open tasks
// steers the run to decide — ask the user (the ask tool opens the answer box)
// or keep going. Nothing continues when the user aborted the run, and
// nothing continues when no open task changed across MAX_STALLS consecutive
// automatic continues — a stall that deep needs the user, not another restart.

/** Stop time before a finish-reason-less stop resumes on its own. */
const RESUME_DELAY_MS = 60_000;
/** Consecutive automatic continues with unchanged open tasks before we give up. */
const MAX_STALLS = 3;
/** The status line of a finished task report (APPEND_SYSTEM.md's contract). */
const FINISH_REASON_RE = /\*\*(?:Done|Partially done|Failed)\.\*\*/;

type Task = { id: number; title: string; progress: number; status: "todo" | "active" | "done" };
type TaskState = { tasks: Task[]; nextId: number };

const EMPTY: TaskState = { tasks: [], nextId: 1 };
const clamp = (p: number) => Math.max(0, Math.min(100, Math.round(p)));

/** What rides in every tool result's `details` — branch-safe state. */
interface TaskDetails {
	action: string;
	tasks: Task[];
	nextId: number;
	warn?: string;
}

const TaskParams = Type.Object({
	action: StringEnum(["add", "progress", "complete", "active", "remove", "replace", "list", "clear"] as const, {
		description:
			"add a task; report progress (id, progress 0-100); complete; mark the one being worked active; remove; replace an old task with a new title (id, title); list; clear all",
	}),
	id: Type.Optional(Type.Number({ description: "task id (everything but add and clear)" })),
	title: Type.Optional(Type.String({ description: "short task title (add, replace)" })),
	progress: Type.Optional(Type.Number({ description: "0-100 (progress)" })),
});

/**
 * The pure reducer every action goes through: the next state plus the text the
 * model reads. `warn` names a refused action — the state is unchanged.
 */
function apply(s: TaskState, i: Static<typeof TaskParams>): { state: TaskState; text: string; warn?: string } {
	const tasks = s.tasks.map((t) => ({ ...t }));
	const one = (id: number | undefined) => (id === undefined ? undefined : tasks.find((t) => t.id === id));
	switch (i.action) {
		case "add": {
			const title = (i.title ?? "").trim();
			if (!title) return { state: s, text: "add needs a title", warn: "title required" };
			const t: Task = { id: s.nextId, title, progress: 0, status: "todo" };
			tasks.push(t);
			return { state: { tasks, nextId: s.nextId + 1 }, text: `Added #${t.id} "${title}" (${tasks.length} tasks)` };
		}
		case "progress": {
			const t = one(i.id);
			if (!t) return { state: s, text: `no task #${i.id}`, warn: "no such task" };
			const p = clamp(i.progress ?? 0);
			t.progress = p;
			t.status = p >= 100 ? "done" : p > 0 ? "active" : "todo";
			return {
				state: { tasks, nextId: s.nextId },
				text: `#${t.id} "${t.title}" at ${p}%${t.status === "done" ? " — done" : ""}`,
			};
		}
		case "complete": {
			const t = one(i.id);
			if (!t) return { state: s, text: `no task #${i.id}`, warn: "no such task" };
			t.progress = 100;
			t.status = "done";
			const left = tasks.filter((x) => x.status !== "done").length;
			return {
				state: { tasks, nextId: s.nextId },
				text: `Completed #${t.id} "${t.title}"${left ? ` (${left} left)` : " — all tasks done"}`,
			};
		}
		case "active": {
			const t = one(i.id);
			if (!t) return { state: s, text: `no task #${i.id}`, warn: "no such task" };
			for (const x of tasks) if (x.status === "active") x.status = "todo";
			if (t.status !== "done") t.status = "active";
			return { state: { tasks, nextId: s.nextId }, text: `Now working on #${t.id} "${t.title}"` };
		}
		case "remove": {
			const t = one(i.id);
			if (!t) return { state: s, text: `no task #${i.id}`, warn: "no such task" };
			return {
				state: { tasks: tasks.filter((x) => x.id !== t.id), nextId: s.nextId },
				text: `Removed #${t.id} "${t.title}"`,
			};
		}
		case "replace": {
			const t = one(i.id);
			const title = (i.title ?? "").trim();
			if (!t) return { state: s, text: `no task #${i.id}`, warn: "no such task" };
			if (!title) return { state: s, text: "replace needs the new title", warn: "title required" };
			const fresh: Task = { id: s.nextId, title, progress: 0, status: "todo" };
			tasks[tasks.findIndex((x) => x.id === t.id)] = fresh;
			return {
				state: { tasks, nextId: s.nextId + 1 },
				text: `Replaced #${t.id} "${t.title}" with #${fresh.id} "${title}" (${tasks.length} tasks)`,
			};
		}
		case "clear":
			return { state: { tasks: [], nextId: s.nextId }, text: `Cleared ${s.tasks.length} task(s)` };
		case "list":
		default:
			return {
				state: s,
				text: s.tasks.length
					? `${s.tasks.length} tasks, ${overall(s)}% overall: ` +
						s.tasks
							.map((t) => `#${t.id} "${t.title}" ${t.status === "done" ? "done" : `${t.progress}%`}`)
							.join(" · ")
					: "no tasks",
			};
	}
}

/** Overall progress: the mean over all tasks, a done task counting 100. */
const overall = (s: TaskState): number =>
	s.tasks.length
		? clamp(s.tasks.reduce((n, t) => n + (t.status === "done" ? 100 : clamp(t.progress)), 0) / s.tasks.length)
		: 0;

const summary = (s: TaskState) =>
	s.tasks.length
		? `${s.tasks.length} tasks, ${overall(s)}% overall: ` +
			s.tasks.map((t) => `#${t.id} ${t.title} (${t.status === "done" ? "done" : `${t.progress}%`})`).join(" · ")
		: "no tasks";

/**
 * The widget: one row per task with the progress bar in front of it, re-rendered from
 * live state so a task update is a `setWidget` call away. The theme is the one
 * the factory got; every state change re-registers with the current one.
 */
class TaskViewWidget {
	private theme: Theme;
	private state: TaskState;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(theme: Theme, state: TaskState) {
		this.theme = theme;
		this.state = state;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const th = this.theme;
		const s = this.state;
		if (!s.tasks.length) {
			this.cachedWidth = width;
			this.cachedLines = [];
			return [];
		}
		const done = s.tasks.filter((t) => t.status === "done").length;
		const lines: string[] = [];
		lines.push(truncateToWidth(th.fg("dim", ` tasks ${done}/${s.tasks.length} done`), width));

		for (const t of s.tasks) {
			const mark =
				t.status === "done" ? th.fg("success", " ✓ ") : t.status === "active" ? th.fg("warning", " ▶ ") : th.fg("dim", " ○ ");
			// marker 3 + id ~4 + bar 12 + status ~7: the title gets the rest.
			const budget = Math.max(8, width - 26);
			const title = t.title.length > budget ? t.title.slice(0, budget - 1) + "…" : t.title;
			const styledTitle = t.status === "active" ? title : th.fg("dim", title);
			const filled = Math.round((clamp(t.progress) * 12) / 100);
			const bar =
				th.fg("dim", "[") +
				(t.status === "done"
					? th.fg("success", "█".repeat(12))
					: th.fg(t.status === "active" ? "success" : "dim", "█".repeat(filled)) +
						th.fg("dim", "░".repeat(12 - filled))) +
				th.fg("dim", "] ") +
				// Padded to 4 cells so the ids and titles behind it form one column.
				(t.status === "done" ? th.fg("success", "done") : th.fg("muted", `${clamp(t.progress)}%`.padStart(4)));
			lines.push(truncateToWidth(` ${mark}${bar} ${th.fg("dim", `#${t.id} `)}${styledTitle}`, width));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export default function taskviewExtension(pi: ExtensionAPI) {
	// In-memory state, reconstructed from the branch's tool results.
	let state: TaskState = EMPTY;

	// Finish-signal runtime: the pending resume timer and the stall bookkeeping.
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	let lastOpenSig = "";
	let stalls = 0;

	const clearResumeTimer = (): void => {
		if (resumeTimer) {
			clearTimeout(resumeTimer);
			resumeTimer = undefined;
		}
	};

	/** The last assistant message on the branch, or undefined when there is none. */
	const lastAssistant = (ctx: ExtensionContext): AssistantMessage | undefined => {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type !== "message") continue;
			if (entry.message.role === "assistant") return entry.message;
		}
		return undefined;
	};

	const assistantText = (msg: AssistantMessage): string =>
		msg.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("\n");

	const reconstructState = (ctx: ExtensionContext) => {
		state = EMPTY;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "task") continue;
			const details = msg.details as TaskDetails | undefined;
			if (details) state = { tasks: details.tasks, nextId: details.nextId };
		}
	};

	/** Redraw the widget above the editor and the footer status; a no-op without a UI. */
	const draw = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const n = Math.round(overall(state) / 10);
		ctx.ui.setStatus(
			"taskview",
			state.tasks.length ? `${"█".repeat(n)}${"░".repeat(10 - n)} ${overall(state)}% of ${state.tasks.length}` : undefined,
		);
		ctx.ui.setWidget("taskview", (tui, theme) => new TaskViewWidget(theme, state));
	};

	const openList = (): { id: number; title: string; progress: number }[] =>
		state.tasks.filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, progress: t.progress }));

	const openTaskLines = (open: { id: number; title: string; progress: number }[]): string =>
		open.map((t) => `  - #${t.id} "${t.title}" (${clamp(t.progress)}%)`).join("\n");

	const finishSignal = (ctx: ExtensionContext): void => {
		clearResumeTimer();
		// Interactive only: print mode has no idle period to resume from.
		if (!ctx.hasUI) return;
		const msg = lastAssistant(ctx);
		if (!msg) return;
		// An explicit stop (esc) or a dead provider outranks the signal — never
		// restart what the user cancelled or what keeps erroring.
		if (msg.stopReason === "aborted" || msg.stopReason === "error") return;

		const open = openList();
		if (!open.length) {
			stalls = 0;
			lastOpenSig = "";
			return;
		}

		const sig = JSON.stringify(open);
		if (sig === lastOpenSig) stalls++;
		else {
			stalls = 0;
			lastOpenSig = sig;
		}
		if (stalls >= MAX_STALLS) {
			ctx.ui.notify(
				`taskview: ${open.length} open task(s) unchanged after ${MAX_STALLS} automatic continues — needs your input`,
				"warning",
			);
			return;
		}

		const list = openTaskLines(open);
		if (FINISH_REASON_RE.test(assistantText(msg))) {
			// A finish reason with open tasks: evaluate whether user input is
			// needed. If yes the ask tool opens the answer box; if no, continue.
			void pi.sendUserMessage(
				`taskview: you reported a finish reason, but ${open.length} task(s) are still open:\n${list}\n` +
					`Decide whether you need user input to proceed. If you do, ask the user now with the ask tool — one question stating exactly what you need — and act on the answer. ` +
					`If you do not, continue working the open tasks to completion, keeping the task view current (action "progress" / "complete").`,
				{ deliverAs: "followUp" },
			);
			return;
		}

		// No finish reason: resume the run after the stop has sat idle a minute.
		resumeTimer = setTimeout(() => {
			resumeTimer = undefined;
			void pi.sendUserMessage(
				`taskview: the run stopped without a finish reason, but ${open.length} task(s) are still open:\n${list}\n` +
					`Continue working them to completion, keeping the task view current (action "progress" / "complete"). ` +
					`End with the standard task report and its status line (**Done.** / **Partially done.** / **Failed.**).`,
				{ deliverAs: "followUp" },
			);
		}, RESUME_DELAY_MS);
	};

	const resetFinishSignal = (): void => {
		clearResumeTimer();
		lastOpenSig = "";
		stalls = 0;
	};

	pi.on("session_start", async (_event, ctx) => {
		resetFinishSignal();
		reconstructState(ctx);
		draw(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		resetFinishSignal();
		reconstructState(ctx);
		draw(ctx);
	});

	// A new run (or shutdown) cancels a pending resume — the user is driving.
	pi.on("agent_start", () => clearResumeTimer());
	pi.on("session_shutdown", () => clearResumeTimer());

	// The finish signal: check every settled stop against the task view.
	pi.on("agent_settled", (_event, ctx) => finishSignal(ctx));

	// The teeth: with an empty task list, the first file-changing call is
	// refused until the work is on the list — the guideline steers, this makes
	// the automatic creation reliable. Read-only work and questions pass.
	const GATE = `taskview: the task list is empty. First break this work into tasks with the task tool — one call with action "add" per task, short titles — then retry this call. Read-only work and pure questions need no tasks.`
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		if ("parentToolCallId" in event && event.parentToolCallId) return; // nested calls: not this loop's turn to gate
		if (state.tasks.length) return;
		return { block: true, reason: GATE };
	});

	// The automatic half: a standing instruction, in the prompt, that the model
	// distils every request into tasks and keeps the view current on its own.
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.promptGuidelines = [
			...(event.systemPromptOptions.promptGuidelines ?? []),
			`Task view: the task tool maintains a live task list drawn above the editor. When the user's request involves creating, changing or fixing anything, you MUST first break the work into tasks with the task tool — one call with action "add" per task — BEFORE starting the work. For a question or chat that produces no files or changes, skip task creation.`,
			`Keep the task view current while you work: action "progress" (id, progress 0-100) as steps finish, action "complete" when a task is done, action "active" for the one you are starting.`,
			`Finish signal: every stop is checked against the task view. End finished work with the status line of the task report (**Done.** / **Partially done.** / **Failed.**). Stopping with open tasks and no status line resumes the run automatically after a minute; a status line with tasks still open makes you either ask the user (ask tool) or continue working.`,
		];
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		description: `The session's task view, drawn above the editor. Maintain it automatically: distil the user's request into tasks, keep progress current, work tasks to completion.`,
		parameters: TaskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { state: next, text, warn } = apply(state, params);
			if (next !== state) state = next;

			draw(ctx);
			return {
				content: [{ type: "text", text }],
				details: { action: params.action, tasks: state.tasks, nextId: state.nextId, warn } as TaskDetails,
				isError: warn !== undefined,
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("muted", args.action);
			if (args.title) text += ` ${theme.fg("dim", `"${args.title}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (args.progress !== undefined) text += ` ${theme.fg("muted", `${args.progress}%`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TaskDetails | undefined;
			const text = result.content[0];
			const body = text?.type === "text" ? text.text : "";
			if (!details) return new Text(body, 0, 0);
			if (details.warn)
				return new Text(
					theme.fg("error", `⚠ ${body}`),
					0,
					0,
				);
			const shown = expanded ? details.tasks : details.tasks.slice(0, 5);
			let list = body;
			if (shown.length) {
				list += "\n" + shown
					.map((t) => {
						const mark = t.status === "done" ? theme.fg("success", "✓") : t.status === "active" ? theme.fg("warning", "▶") : theme.fg("dim", "○");
						return `${mark} ${theme.fg("accent", `#${t.id}`)} ${t.status === "active" ? t.title : theme.fg("dim", t.title)} ${theme.fg("muted", t.status === "done" ? "done" : `${t.progress}%`)}`;
					})
					.join("\n");
				if (!expanded && details.tasks.length > 5)
					list += `\n${theme.fg("dim", `... ${details.tasks.length - 5} more`)}`;
			}
			return new Text(list, 0, 0);
		},
	});

	pi.registerCommand("tasks", {
		description: "Show the session's task view",
		handler: async (_args, ctx) => {
			ctx.ui.notify(summary(state), "info");
		},
	});
}