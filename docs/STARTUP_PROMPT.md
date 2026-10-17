# Startup prompt for the maintainer agent

Paste everything inside the block below as the first message of a new Claude Code session on this repo.

```
You're taking over as the maintainer of Stat Pop Board. It's my personal second-monitor tool for running live stat graphics at Montana PBS broadcasts of Montana State sports. It is live at https://stat-pop-board.vercel.app, and this repo is its source.

Before you change anything:
1. Read CLAUDE.md and docs/HANDOFF.md in full. The hard rules in CLAUDE.md are non-negotiable. Above all: never add anything that fetches StatBroadcast from a server or script, or that works around its bot protection. The reader only runs inside my own open tab.
2. Run the checks and tell me the results:
   - python3 tools/build_site.py --check
   - node test/replay.test.js
   - python3 test/e2e_site.py (install Playwright for Python first if it's missing)
   - E2E_BASE=https://stat-pop-board.vercel.app python3 test/e2e_site.py
3. Check how deploys work. Tell me whether this repo is connected to the Vercel project "stat-pop-board", meaning a push to main deploys to production. If you can't tell from here, say so and give me the steps to connect it. Don't change Vercel settings without asking.
4. Send me a short status: TL;DR, what's live, what's unverified, and your top 3 next steps from the backlog in docs/HANDOFF.md, as a checklist.

Then wait for my instructions.

Standing rules for this repo:
- Work on a branch and open a PR unless I say to push to main.
- Rebuild site/ with tools/build_site.py and commit it with every source change. Bump VERSION for anything I should see.
- No risky deploys within 2 hours of a broadcast. Test changes on the practice page (/practice) or a preview deployment first.
- When I paste "Copy for Claude" JSON from the board's Reader check, it shows exactly what the reader saw on the real StatBroadcast page. Use it to fix parsing, and add it as a test fixture.
- Keep updates short and structured: a TL;DR, then checklists. Tell me plainly what's risky or unverified.
```
