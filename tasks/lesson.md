# Lessons

Rules learned from corrections and mistakes — reviewed at session start.

---

## 2026-03-13

### Use `tasks/todo.md` and `tasks/lesson.md`, not just the UI TodoWrite tool

**Mistake:** Used only the built-in `TodoWrite` tool (UI sidebar) for task tracking.
**Rule:** Always write the plan to `tasks/todo.md` with checkable items AND use `TodoWrite`. The file is the persistent record; the UI tool is just live progress tracking.

### Verify if a test failure is pre-existing before assuming your changes caused it

**Mistake:** Test failure was seen after changes — needed to explicitly stash and re-run to confirm it was pre-existing.
**Rule:** When a test fails after edits, immediately `git stash && run tests` to confirm whether it was already failing. Don't assume causation without checking.

### Fix pre-existing test failures, don't just note them

**Mistake (potential):** Could have just noted the test failure and moved on.
**Rule:** If a test was already failing, trace the root cause and fix it. The `leaveParty cleans up continue/lobby votes` test had a party-size/majority mismatch — adding a 4th player in the test setup was the correct fix, not skipping or ignoring it.
