[docs](../README.md) / [prompts](./README.md) / change-request-planning

# Change Request Planning

**Prompt name**: `change_request_planning`

Structured change request creation with risk assessment, implementation/backout plans, and lifecycle management.

## Workflow Sequence

### Step 1: Check for Conflicts

Search for existing changes in the same maintenance window.

```
search_change_requests({ state: "Scheduled", limit: 10 })
```

### Step 2: Risk Assessment

Guides evaluation of impact scope, complexity, reversibility, testing, and dependencies.

### Step 3: Implementation Plan

Template for writing step-by-step implementation actions with pre-checks, validation steps, and communication plan.

### Step 4: Backout Plan

Template covering decision criteria, rollback steps, post-rollback validation, and expected duration.

### Step 5: Create the Change Request

Calls [`create_change_request`](../tools/change-requests.md#create_change_request) with type, impact, urgency, scheduling, and full description.

### Step 6: Lifecycle Management

Guides the change through: `New → Assess → Authorize → Scheduled → Implement → Review → Closed`

Covers state transitions via [`update_change_request`](../tools/change-requests.md#update_change_request) and progress tracking via [`add_change_request_work_note`](../tools/change-requests.md#add_change_request_work_note).

## Change Types

| Type | When to Use | Approval |
|------|------------|----------|
| Normal | Planned changes requiring review | CAB approval |
| Standard | Pre-approved, low-risk, repeatable | No CAB |
| Emergency | Unplanned, to restore service | Expedited |

## Referenced Tools

- [`search_change_requests`](../tools/change-requests.md#search_change_requests) — conflict check
- [`create_change_request`](../tools/change-requests.md#create_change_request) — creation
- [`update_change_request`](../tools/change-requests.md#update_change_request) — state transitions
- [`add_change_request_work_note`](../tools/change-requests.md#add_change_request_work_note) — progress notes
- [`get_change_request_approvals`](../tools/change-requests.md#get_change_request_approvals) — approval tracking
- [`lookup_group`](../tools/users-and-groups.md#lookup_group) — assignment group lookup
