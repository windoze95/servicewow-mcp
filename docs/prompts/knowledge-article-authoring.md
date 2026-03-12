[docs](../README.md) / [prompts](./README.md) / knowledge-article-authoring

# Knowledge Article Authoring

**Prompt name**: `knowledge_article_authoring`

Guide for writing effective knowledge base articles with templates and best practices.

## Workflow Sequence

### Step 1: Check for Existing Articles

Search before writing to avoid duplicates.

```
search_knowledge({ query: "topic", limit: 10 })
get_article({ sys_id: "<article_sys_id>" })
```

### Step 2: Choose Article Type

| Type | Use For |
|------|---------|
| How-To | Step-by-step procedures |
| Troubleshooting | Problem → Cause → Resolution |
| Reference | Policies, standards, specifications |
| FAQ | Common questions with concise answers |
| Known Error | Documented problems with workarounds |

### Step 3: Structure the Article

Provides HTML templates for How-To and Troubleshooting articles covering:
- Overview and prerequisites
- Step-by-step instructions
- Verification steps
- Related articles

### Step 4: Metadata and Classification

Guides knowledge base selection, category placement, keyword tagging, and audience targeting.

## Article Lifecycle

```
Draft → Review → Published → (Outdated → Retired)
```

## Writing Best Practices

- Use plain language appropriate for the audience
- One concept per article
- Include exact error messages for searchability
- Note applicable software versions
- Test procedures before publishing
- Link to related articles rather than duplicating

## Referenced Tools

- [`search_knowledge`](../tools/knowledge.md#search_knowledge) — existing article search
- [`get_article`](../tools/knowledge.md#get_article) — article review
