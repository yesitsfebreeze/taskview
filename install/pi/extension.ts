/**
 * taskview for pi — the session's task view, drawn above the status bar.
 *
 * The Claude Code twin is the repo's `hooks/register.ts`; this is the pi port,
 * one file so it installs standalone as `~/.pi/agent/extensions/taskview.ts`.
 *
 * - Registers a `task` tool: the model distils the user's requests into up to
 *   5 tasks on its own (the before_agent_start guideline below tells it to),
 *   keeps progress current while it works, and works tasks to completion.
 * - Draws the list as a widget above the editor: one row per task, a progress
 *   bar beside each, the count in a header, and a loud warning when full.
 * - At 5/5 an add is refused with an error result and a notification, so the
 *   user is told an old task has to be replaced (action "replace") first.
 *
 * State follows the branch: the whole task list rides in every tool result's
 * `details` and is reconstructed from the branch on session_start/session_tree.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

/** The view holds at most this many tasks; the next add must replace one. */
const CAPACITY = 5;

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
 * model reads. `warn` is the capacity refusal — the add was NOT made and the
 * model must tell the user an old task has to make room.
 */
function apply(s: TaskState, i: Static<typeof TaskParams>): { state: TaskState; text: string; warn?: string } {
	const tasks = s.tasks.map((t) => ({ ...t }));
	const one = (id: number | undefined) => (id === undefined ? undefined : tasks.find((t) => t.id === id));
	switch (i.action) {
		case "add": {
			const title = (i.title ?? "").trim();
			if (!title) return { state: s, text: "add needs a title", warn: "title required" };
			if (tasks.length >= CAPACITY)
				return {
					state: s,
					warn: "full",
					text: `WARNING: the task view is full (${CAPACITY}/${CAPACITY}) — "${title}" was NOT added. Tell the user the list is full and an old task must make room: either call action "replace" with the id of the task to retire, or complete/remove one first.`,
				};
			const t: Task = { id: s.nextId, title, progress: 0, status: "todo" };
			tasks.push(t);
			return { state: { tasks, nextId: s.nextId + 1 }, text: `Added #${t.id} "${title}" (${tasks.length}/${CAPACITY})` };
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
				text: `Replaced #${t.id} "${t.title}" with #${fresh.id} "${title}" (${tasks.length}/${CAPACITY})`,
			};
		}
		case "clear":
			return { state: { tasks: [], nextId: s.nextId }, text: `Cleared ${s.tasks.length} task(s)` };
		case "list":
		default:
			return {
				state: s,
				text: s.tasks.length
					? `${s.tasks.length}/${CAPACITY}: ` +
						s.tasks
							.map((t) => `#${t.id} "${t.title}" ${t.status === "done" ? "done" : `${t.progress}%`}`)
							.join(" · ")
					: "no tasks",
			};
	}
}

const summary = (s: TaskState) =>
	s.tasks.length
		? `${s.tasks.length}/${CAPACITY}: ` +
			s.tasks.map((t) => `#${t.id} ${t.title} (${t.status === "done" ? "done" : `${t.progress}%`})`).join(" · ")
		: "no tasks";

/**
 * The widget: one row per task with a progress bar beside it, re-rendered from
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
		let header = th.fg("dim", " tasks ") + th.fg(s.tasks.length >= CAPACITY ? "warning" : "muted", `${s.tasks.length}/${CAPACITY}`);
		if (done) header += th.fg("dim", ` · ${done} done`);
		if (s.tasks.length >= CAPACITY) header += th.fg("warning", " ⚠ full — replace a task to add another");
		lines.push(truncateToWidth(header, width));

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
				(t.status === "done" ? th.fg("success", "done") : th.fg("muted", `${clamp(t.progress)}%`));
			lines.push(truncateToWidth(` ${mark}${th.fg("dim", `#${t.id} `)}${styledTitle} ${bar}`, width));
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

	/** Redraw the widget above the editor; a no-op without a UI. */
	const draw = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("taskview", (tui, theme) => new TaskViewWidget(theme, state));
	};

	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
		draw(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
		draw(ctx);
	});

	// The automatic half: a standing instruction, in the prompt, that the model
	// distils every request into tasks and keeps the view current on its own.
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.promptGuidelines = [
			...(event.systemPromptOptions.promptGuidelines ?? []),
			`Task view: the task tool maintains a live task list drawn above the editor. When the user's request describes concrete work, automatically distil it into up to ${CAPACITY} tasks — call task with action "add" once per task, no need to ask.`,
			`Keep the task view current while you work: action "progress" (id, progress 0-100) as steps finish, action "complete" when a task is done, action "active" for the one you are starting.`,
			`The task view holds at most ${CAPACITY} tasks. When it is full, tell the user an old task must make room and use action "replace" (id of the old task, new title) or remove/complete one before adding another.`,
		];
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		description: `The session's task view, drawn above the editor. Maintain it automatically: distil the user's request into up to ${CAPACITY} tasks, keep progress current, work tasks to completion.`,
		parameters: TaskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { state: next, text, warn } = apply(state, params);
			if (next !== state) state = next;

			// The capacity refusal reaches the user twice: the error result the
			// model has to answer for, and the warning next to the full list.
			if (warn === "full" && ctx.hasUI)
				ctx.ui.notify(`Task view full (${CAPACITY}/${CAPACITY}) — replace an old task to add another`, "warning");

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
					theme.fg(details.warn === "full" ? "warning" : "error", `⚠ ${body}`),
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