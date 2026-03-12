[docs](../README.md) / [prompts](./README.md) / configure-ui-policy

# Configure UI Policy

**Prompt name**: `configure_catalog_ui_policy`

Guide for setting up UI policies with IO:{sys_id} conditions and field-level actions.

## Overview

UI policies declaratively control field visibility, mandatory state, and disabled state based on variable values — no scripting required for common patterns.

## Workflow

### Step 1: Create the UI Policy

Use [`create_catalog_ui_policy`](../tools/catalog-admin.md#create_catalog_ui_policy). The key field is `catalog_conditions`, which uses the `IO:{var_sys_id}` format.

```
create_catalog_ui_policy({
  short_description: "Show details when priority is High",
  catalog_item: item_sys_id,
  catalog_conditions: "IO:{priority_var_sys_id}=high^EQ",
  on_load: true,
  reverse_if_false: true,
  order: 100,
})
→ save result.data.sys_id as policy_sys_id
```

### Condition Syntax

- `IO:` prefix is required for catalog variables
- `{variable_sys_id}` is the 32-char sys_id (not the name)
- Operators: `=`, `!=`, `IN`, `NOTIN`, `ISEMPTY`, `ISNOTEMPTY`
- Chain with `^` (AND) or `^OR` (OR), terminate with `^EQ`

**Multiple conditions**: `"IO:{type_sys_id}=hardware^IO:{priority_sys_id}=high^EQ"`

### Step 2: Add Policy Actions

Call [`create_catalog_ui_policy_action`](../tools/catalog-admin.md#create_catalog_ui_policy_action) for each variable the policy should affect.

```
create_catalog_ui_policy_action({
  ui_policy: policy_sys_id,
  catalog_variable: "IO:{details_var_sys_id}",
  visible: "true",
  mandatory: "true",
  disabled: "Leave alone",
})
```

**Action values** are strings, not booleans:
- `"true"` — enforce the state
- `"false"` — enforce the opposite
- `"Leave alone"` — don't change this property

### `reverse_if_false` Behavior

| Setting | Condition TRUE | Condition FALSE |
|---|---|---|
| `true` (default) | Actions apply as configured | Actions are reversed |
| `false` | Actions apply | No change |

"Reversed" means: `visible: "true"` → field hidden, `mandatory: "true"` → field optional.

## Common Patterns

### Show/Hide Field Based on Dropdown

1. Condition: `IO:{dropdown_sys_id}=specific_value^EQ`
2. Action: `catalog_variable: "IO:{target_sys_id}", visible: "true"`
3. With `reverse_if_false: true`, the field auto-hides when the value changes

### Conditional Mandatory

1. Condition: `IO:{checkbox_sys_id}=true^EQ`
2. Action: `catalog_variable: "IO:{text_field_sys_id}", mandatory: "true"`

### Multiple Actions on One Policy

Create multiple `create_catalog_ui_policy_action` calls with the same `ui_policy` sys_id. All fire together.

## Gotchas

- **IO: prefix is required** in both `catalog_conditions` and `catalog_variable`
- **Action values are strings**: `"true"` / `"false"` / `"Leave alone"`, not boolean
- **Condition must end with `^EQ`**
- **Order matters**: lower order = higher priority when policies conflict

---

**See also**: [Configure Client Script](./configure-client-script.md) · [Catalog Administration Tools](../tools/catalog-admin.md) · [Build Catalog Form](./build-catalog-form.md)
