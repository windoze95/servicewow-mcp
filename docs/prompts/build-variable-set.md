[docs](../README.md) / [prompts](./README.md) / build-variable-set

# Build Variable Set

**Prompt name**: `build_catalog_variable_set`

Guide for creating and attaching reusable variable sets to catalog items.

## Overview

Variable sets are reusable collections of variables that can be attached to multiple catalog items. Define fields once, reuse everywhere.

## Workflow

### Step 1: Create the Variable Set

Use [`create_variable_set`](../tools/catalog-admin.md#create_variable_set).

```
create_variable_set({
  title: "Contact Information",
  internal_name: "contact_info",
  type: "one_to_one",
  description: "Standard contact fields for requesters",
  order: 100,
})
→ save result.data.sys_id as set_sys_id
```

**Set types**:
- **`one_to_one`** (Single Row, default): Variables display inline on the form. Use for reusable field groups (contact info, approval details).
- **`one_to_many`** (Multi Row): Displays as an embedded list/grid where users can add multiple rows. Use for line items (hardware orders, user lists).

### Step 2: Attach to a Catalog Item

Use [`attach_variable_set`](../tools/catalog-admin.md#attach_variable_set) to create the M2M relationship.

```
attach_variable_set({
  sc_cat_item: item_sys_id,
  variable_set: set_sys_id,
  order: 200,
})
```

Attach the same set to multiple items by calling `attach_variable_set` once per item.

### Step 3: Add Variables to the Set

Variables are added to variable sets through the **ServiceNow UI**, not through the `create_catalog_variable` tool (which requires a `cat_item` parameter and targets catalog items directly).

1. Navigate to the variable set record in ServiceNow
2. Use the "Variables" related list to add new variables

### Step 4: Verify

Use [`list_catalog_variables`](../tools/catalog-admin.md#list_catalog_variables) with `include_set_variables: true`:

```
list_catalog_variables({
  cat_item: item_sys_id,
  include_set_variables: true,
})
```

## When to Use Variable Sets vs Direct Variables

| Use Variable Sets When | Use Direct Variables When |
|---|---|
| Same fields on 3+ catalog items | Fields unique to one item |
| Want consistent definitions across items | Need full control over ordering |
| Changes should propagate to all items | Form is simple, no reuse needed |
| Need multi-row data entry (`one_to_many`) | |

## Gotchas

- **Variables can't be added to sets via the API tools**: `create_catalog_variable` targets items, not sets
- **Ordering**: the set's `order` on the attachment controls where set variables appear relative to direct variables
- **Detaching**: no detach tool — remove the `io_set_item` record through the ServiceNow UI
- **`one_to_many` sets**: each row is a separate record; they behave differently in scripts and conditions

---

**See also**: [Build Catalog Form](./build-catalog-form.md) · [Configure UI Policy](./configure-ui-policy.md) · [Catalog Administration Tools](../tools/catalog-admin.md)
