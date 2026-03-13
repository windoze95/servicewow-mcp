import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function changeRequestPlanningPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Change Request Planning — Structured Change Creation Guide

## Overview

This guide walks through creating a well-structured change request in ServiceNow, including risk assessment, scheduling, and the approval lifecycle.

## Change Types

| Type | When to Use | Approval |
|------|------------|----------|
| **Normal** | Planned changes requiring review | CAB approval required |
| **Standard** | Pre-approved, low-risk, repeatable changes | No CAB — follows a template |
| **Emergency** | Unplanned changes to restore service | Expedited approval, post-implementation review |

## Step 1: Check for Conflicts

Search for existing changes in the same window:

\`\`\`
search_change_requests({
  state: "Scheduled",
  limit: 10,
})
\`\`\`

Avoid scheduling during:
- Active maintenance windows for the same CI
- Change freeze periods
- Peak business hours (unless emergency)

## Step 2: Risk Assessment

Consider these factors:
- **Impact scope**: How many users/services affected?
- **Complexity**: How many systems touched? Custom code involved?
- **Reversibility**: Can the change be backed out quickly?
- **Testing**: Has this been validated in a sub-production environment?
- **Dependencies**: Are there upstream/downstream system dependencies?

## Step 3: Write the Implementation Plan

A good implementation plan includes:
1. Pre-implementation checks (verify backups, confirm maintenance window)
2. Step-by-step implementation actions with expected duration
3. Validation steps after each major action
4. Communication plan (who to notify at each stage)

## Step 4: Write the Backout Plan

Every change needs a backout plan:
1. Decision criteria (when to invoke backout)
2. Step-by-step rollback actions
3. Validation after rollback
4. Expected rollback duration
5. Communication if backout is triggered

## Step 5: Create the Change Request

\`\`\`
create_change_request({
  short_description: "Clear summary of what is changing",
  description: "Detailed description including:\\n- What: specific change being made\\n- Why: business justification\\n- Implementation plan\\n- Backout plan\\n- Testing evidence",
  type: "Normal",
  impact: 2,
  urgency: 2,
  category: "Infrastructure",
  assignment_group: "<group>",
  cmdb_ci: "<affected_ci>",
  start_date: "2026-04-01T02:00:00Z",
  end_date: "2026-04-01T06:00:00Z",
})
\`\`\`

## Step 6: Manage the Lifecycle

Change requests follow this lifecycle:

\`\`\`
New → Assess → Authorize → Scheduled → Implement → Review → Closed
\`\`\`

Update the state as you progress:

\`\`\`
update_change_request({
  identifier: "CHG0012345",
  fields: { state: "Implement" }
})
\`\`\`

Add work notes to document progress:

\`\`\`
add_change_request_work_note({
  identifier: "CHG0012345",
  note: "Implementation started. Step 1 of 5 complete.",
  type: "work_note"
})
\`\`\`

## CAB Requirements (Normal Changes)

- Submit for CAB review during the **Assess** state
- Include: risk assessment, implementation plan, backout plan, test results
- Use \`get_change_request_approvals\` to track approval status
- CAB typically meets weekly — plan submission timing accordingly

## Best Practices

- **Schedule buffer**: Add 30-50% time buffer beyond estimated duration
- **Maintenance windows**: Prefer off-peak hours for high-impact changes
- **Communication**: Notify affected users before, during, and after
- **Documentation**: Update the change with actual implementation notes and any deviations from plan
- **Post-implementation review**: Always close the loop — document lessons learned`,
        },
      },
    ],
  };
}

export function registerChangeRequestPrompts(server: McpServer): void {
  server.prompt(
    "change_request_planning",
    "Structured change request creation with risk assessment, implementation/backout plans, and lifecycle management",
    () => changeRequestPlanningPrompt()
  );
}
