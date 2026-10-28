# taskview for Codex

Provides the `task` MCP tool: add, replace, remove, list, clear, activate, progress, complete and block tasks per session, with no task limit. SQLite transactions preserve state across compaction and concurrent calls. SessionStart restores state; Stop reports progress. Orly remains the completion gate: this adapter deliberately has no independent resume timer or Stop rejection loop. The Claude above-prompt panel is not available here. State is private under `$CODEX_HOME/taskview/state.sqlite`.

Install from this repository’s existing marketplace, or the collection marketplace
`codex plugin marketplace add ~/dev/claude-plugins` followed by
`codex plugin add taskview@claude-plugins`. The local Kern installation retains
`kern@personal` for compatibility. New skills are discoverable in a fresh turn;
restart the thread/application if its tool catalog is already loaded.

For Steward and Taskview, review the exact hook definitions in Codex `/hooks`.
Installation alone does not trust hooks. No adapter writes hook trust settings.

Validation from this repository: `bun test ./install/codex/tasks.check.ts`.
