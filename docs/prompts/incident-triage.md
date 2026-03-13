[docs](../README.md) / [prompts](./README.md) / incident-triage

# Incident Triage

**Prompt name**: `incident_triage`

Guided incident classification with impact/urgency assessment, priority matrix, and assignment.

## Workflow Sequence

### Step 1: Check for Duplicates

Search for existing incidents with similar symptoms before creating a new one.

```
search_incidents({ query: "description of the issue", limit: 5 })
```

### Step 2: Assess Impact and Urgency

Uses ServiceNow's 1-3 scale:

| Value | Impact | Urgency |
|-------|--------|---------|
| 1 | High — enterprise-wide | High — critical function down |
| 2 | Medium — single department | Medium — degraded, workaround exists |
| 3 | Low — single user | Low — minimal business effect |

Includes the full priority matrix (Impact × Urgency → P1-P5).

### Step 3: Classify

Guides category/subcategory selection (Hardware, Software, Network, Database, Security, Service).

### Step 4: Assign

Uses [`lookup_group`](../tools/users-and-groups.md#lookup_group) to find the correct assignment group.

### Step 5: Create

Calls [`create_incident`](../tools/incidents.md#create_incident) with all classified fields.

## Referenced Tools

- [`search_incidents`](../tools/incidents.md#search_incidents) — duplicate check
- [`create_incident`](../tools/incidents.md#create_incident) — creation
- [`update_incident`](../tools/incidents.md#update_incident) — triage updates
- [`add_work_note`](../tools/incidents.md#add_work_note) — investigation notes
- [`lookup_group`](../tools/users-and-groups.md#lookup_group) — assignment group lookup
