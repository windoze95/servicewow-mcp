import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function incidentTriagePrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Incident Triage — Guided Classification and Assignment

## Overview

This guide walks through the process of properly classifying, prioritizing, and assigning a new incident in ServiceNow.

## Step 1: Check for Duplicates

Before creating a new incident, search for existing ones:

\`\`\`
search_incidents({
  query: "brief description of the issue",
  limit: 5,
})
\`\`\`

Look for matching symptoms, affected CIs, or similar timeframes. If a duplicate exists, consider adding a work note to the existing incident instead.

## Step 2: Assess Impact and Urgency

ServiceNow uses a 1-3 scale for both impact and urgency, which together determine priority:

| Value | Impact (breadth) | Urgency (time sensitivity) |
|-------|------------------|---------------------------|
| 1 | High — enterprise/multiple departments | High — critical function unavailable |
| 2 | Medium — single department/group | Medium — degraded but workaround exists |
| 3 | Low — single user | Low — minimal business effect |

**Priority Matrix** (Impact × Urgency):

| | Urgency 1 | Urgency 2 | Urgency 3 |
|---|---|---|---|
| Impact 1 | P1 - Critical | P2 - High | P3 - Moderate |
| Impact 2 | P2 - High | P3 - Moderate | P4 - Low |
| Impact 3 | P3 - Moderate | P4 - Low | P5 - Planning |

Priority is calculated automatically by ServiceNow from impact and urgency — do not set it directly.

## Step 3: Classify the Incident

Choose the appropriate category and subcategory. Common categories:
- **Hardware** — physical device failures, peripherals
- **Software** — application errors, crashes, bugs
- **Network** — connectivity, DNS, VPN, firewall
- **Database** — query failures, performance, corruption
- **Security** — access issues, potential breaches, policy violations
- **Service** — service outages, degradation

## Step 4: Identify the Assignment Group

Use \`lookup_group\` to find the correct assignment group:

\`\`\`
lookup_group({ query: "network operations" })
\`\`\`

Match based on:
- Category/subcategory of the issue
- Affected CI or service
- Geography/timezone requirements

## Step 5: Create the Incident

\`\`\`
create_incident({
  short_description: "Clear, specific summary",
  description: "Detailed description including: what happened, when, who is affected, error messages, steps to reproduce",
  impact: 2,
  urgency: 2,
  category: "Software",
  subcategory: "Application",
  assignment_group: "<group_sys_id_or_name>",
  cmdb_ci: "<ci_name_or_sys_id>",
})
\`\`\`

## Step 6: Link Related Records (Optional)

After creation, you can:
- Add work notes with investigation details: \`add_work_note\`
- Update fields as triage progresses: \`update_incident\`

## Best Practices

- **Short description**: Be specific. "Email not working" → "Outlook 365 crashes on startup for Finance dept users"
- **Description**: Include who, what, when, where, error messages, and business impact
- **Don't over-escalate**: Use the priority matrix honestly — not everything is P1
- **Assignment**: Route to the right group first time to avoid reassignment delays
- **CI linking**: Always link to the affected Configuration Item when known — this builds the CMDB relationship map`,
        },
      },
    ],
  };
}

export function registerIncidentPrompts(server: McpServer): void {
  server.prompt(
    "incident_triage",
    "Guided incident classification with impact/urgency assessment, priority matrix, and assignment",
    () => incidentTriagePrompt()
  );
}
