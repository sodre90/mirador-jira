# Jira for Mirador

A Mirador workspace-tab plugin (plugin API 7). See README.md for what it does and how to run it.

- Bun and TypeScript everywhere, strict; imports carry their `.ts`/`.tsx` extensions. React 19 for the view.
- `bun run typecheck`, `bun run test` (not a bare `bun test`, which would pick up the Playwright specs) and `scripts/e2e.sh` before every commit. The e2e uses Mirador's Playwright, which runs on Node: no Bun APIs in `e2e/`. It puts `tests/fake-acli-program.ts` on the test host's PATH as `acli`.
- `jira/` is pure apart from `tab.ts` and `run.ts`; `host.ts` hands Mirador the tab; `view/` draws it in Mirador's sandboxed frame and talks to the host only through `window.mirador`. The sandbox has no `allow-forms` and no network: no `<form>`, and nothing loads from Jira (no avatars or attachments).
- acli 1.3's limits shape the design. `workitem search --fields` takes only issuetype, key, summary, status, priority, assignee, reporter, labels and description, so lists hold those and an opened issue's `view --fields '*navigable,comment'` brings the rest. Nothing lists an issue's transitions, so the status picker offers the statuses the tab has seen. `edit` can't change priority.
- Jira is a shared server: reads are single-flight per key with a minimum gap, counts come only when the tab opens and after writes, and at most three acli calls run at once. Keep it that way.
- Every write goes through `writePlan` in `jira/acli.ts`, so the command a sheet previews is the one that runs. Your own small changes (status, assigning yourself, labels) happen at once and return an Undo, which re-reads the issue and refuses when someone changed it since. Anything Jira tells others about asks first.
- acli's answers to writes (`create --json`, `comment create`, `edit --from-json`) are modelled on its help and errors, not yet seen against a real site: `tests/fake-acli.ts` must behave like the real acli, so check a command against acli itself before relying on it.
- Rich text is ADF. `jira/adf.ts` turns Markdown into ADF and back, and the description edits as Markdown only when it round-trips exactly (no mentions, media or tables).
- Fixtures and the e2e's Jira are made up (Kite, a note-taking app, on kite.example.com). Never copy a real site's issues, keys, names, emails, account ids, sprints or boards into this repo.
- Names over comments: keep comments for a genuine "why" that a name can't carry.
- Every change comes with tests: logic gets unit tests, and what the user sees gets e2e coverage.
- Words the user or the agent reads: plain words and sentence case. An issue key shown to the user carries its summary.
- Commits: authored by the owner only, with no AI attribution or trailers. One plain sentence saying what the user gets.
- Releases: bump `version` in `plugin.json` and tag the commit `v<version>`; Mirador refuses a tag that doesn't match.
