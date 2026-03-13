import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function knowledgeArticleAuthoringPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Knowledge Article Authoring — Writing Guide

## Overview

This guide helps create effective knowledge base articles in ServiceNow that are findable, readable, and actionable.

## Step 1: Check for Existing Articles

Before writing, search for existing coverage:

\`\`\`
search_knowledge({
  query: "topic you want to write about",
  limit: 10,
})
\`\`\`

If a related article exists, consider updating it rather than creating a duplicate. Use \`get_article\` to review its current content:

\`\`\`
get_article({ sys_id: "<article_sys_id>" })
\`\`\`

## Step 2: Choose the Article Type

| Type | Use For |
|------|---------|
| **How-To** | Step-by-step procedures ("How to reset your VPN password") |
| **Troubleshooting** | Problem → Cause → Resolution format |
| **Reference** | Policies, standards, specifications, lookup tables |
| **FAQ** | Common questions with concise answers |
| **Known Error** | Documented problems with known workarounds |

## Step 3: Structure the Article

### Title (short_description)
- Start with action verb for How-To: "Configure", "Reset", "Install", "Troubleshoot"
- Be specific: "Reset VPN Password on Windows 11" not "Password Issues"
- Include the product/system name

### Body (text field — supports HTML)

**How-To Template**:
\`\`\`html
<h2>Overview</h2>
<p>Brief description of what this article covers and who it's for.</p>

<h2>Prerequisites</h2>
<ul>
  <li>Required access/permissions</li>
  <li>Required software/tools</li>
</ul>

<h2>Steps</h2>
<ol>
  <li>First step with specific details</li>
  <li>Second step — include expected results</li>
  <li>Third step — note any common variations</li>
</ol>

<h2>Verification</h2>
<p>How to confirm the procedure was successful.</p>

<h2>Related Articles</h2>
<ul>
  <li>Links to related KB articles</li>
</ul>
\`\`\`

**Troubleshooting Template**:
\`\`\`html
<h2>Symptoms</h2>
<p>What the user sees or experiences.</p>

<h2>Cause</h2>
<p>Root cause or common causes.</p>

<h2>Resolution</h2>
<ol>
  <li>Step-by-step fix</li>
</ol>

<h2>Workaround</h2>
<p>Temporary alternative if the full fix isn't available.</p>
\`\`\`

## Step 4: Metadata and Classification

- **Knowledge base**: Select the appropriate KB (e.g., IT, HR, Facilities)
- **Category**: Place in the correct category for discoverability
- **Keywords**: Add search terms users might use (synonyms, abbreviations)
- **Audience**: Internal IT, end users, or specific departments

## Article Lifecycle

\`\`\`
Draft → Review → Published → (Outdated → Retired)
\`\`\`

- Articles start as **Draft**
- Submit for **Review** when content is complete
- Reviewers publish or return with feedback
- Set review dates to keep content current
- **Retire** articles that are no longer relevant (don't delete — they may be referenced by closed incidents)

## Writing Best Practices

- **Use plain language**: Write at the level of your audience, avoid unnecessary jargon
- **Be concise**: One concept per article — split long articles into a series
- **Use screenshots sparingly**: They become outdated quickly; prefer text descriptions of UI elements
- **Include error messages**: Quote exact error text so users can find the article by searching the error
- **Version-specific**: Note which software versions the article applies to
- **Test your steps**: Walk through the procedure yourself before publishing
- **Link, don't duplicate**: Reference other KB articles instead of repeating their content`,
        },
      },
    ],
  };
}

export function registerKnowledgePrompts(server: McpServer): void {
  server.prompt(
    "knowledge_article_authoring",
    "Guide for writing effective knowledge base articles with templates and best practices",
    () => knowledgeArticleAuthoringPrompt()
  );
}
