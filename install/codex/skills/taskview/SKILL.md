---
name: taskview
description: "Track and restore outcomes during substantial implementation work, including after compaction or resume. Use when work spans several steps or the user requests task progress."
---

Use taskview `task` with the actual session id from the startup hook. List before creating; refine existing tasks across follow-ups. Keep one task active, update meaningful progress, and complete only outcomes verified by evidence. Use block with a concrete reason when external input is required, and report it to the user.

Orly owns completion checks and continuation. Taskview supplies persistent evidence and a turn-end status; it does not create a second resume loop or override a user stop. Use Orly specs for decidable completion checks when applicable. No Claude above-prompt panel is assumed.
