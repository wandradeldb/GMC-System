---
name: execution_workflow_strategy
description: Full autonomy + transparent sub agent usage
metadata:
  type: feedback
---

## Full Autonomy (NEVER ask permission)

You granted blanket authorization. I execute everything EXCEPT deletions without asking:
- ✅ Create/edit code (React, Node, CSS, SQL)
- ✅ Run/test servers
- ✅ Install dependencies
- ✅ Modify files, configs, scripts
- ✅ Refactor, bugfix
- ⚠️ ONLY ask: If deleting data/files (confirm before irreversible action)

**Stop asking.** Just do it.

---

## Sub Agent Transparency

When I spawn a sub agent:
1. **Announce it** — "Spawning Code Reviewer agent to validate changes..."
2. **Show the conversation** — Visible in chat so you see what I asked + their response
3. **Report result** — Summarize findings

You can follow the entire back-and-forth. No hidden conversations.

**When I use sub agents:**
- Only if genuinely needed (complex analysis, validation, parallel work)
- Never by default
- Always visible to you

---

## Workflow (Opção C - Hybrid Intelligent)

**User provides:** List of 3-5 features/fixes

**I analyze:** Dependencies, risk, grouping → group by theme

**I execute per group:**
1. Implement
2. Quick self-test
3. If high-risk: Spawn validator agent (visible)
4. Report: "Group X done ✓"

**Result:**
- ⚡ 40% faster
- 🔒 Safer (conflicts detected early)
- 💰 20-30% fewer tokens
- 👀 Transparent (you see everything)
