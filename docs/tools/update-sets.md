[docs](../README.md) / [tools](./README.md) / update-sets

# Update Set Tools (2)

Tools for managing ServiceNow update sets. Update sets track configuration changes for deployment across instances.

## `change_update_set`

Change the authenticated user's current ServiceNow update set by sys_id or name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Update set sys_id or exact update set name |

**Behavior**:
1. Queries `sys_update_set` for an in-progress update set matching the identifier
2. If searching by name and multiple matches are found, returns `AMBIGUOUS_MATCH` with the list of candidates
3. Updates (or creates) a `sys_user_preference` record to set the user's current update set

**Ambiguous match example**: If multiple in-progress update sets share the same name, use the sys_id instead.

## `create_update_set`

Create a new update set and optionally set it as the current update set.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Name of the new update set |
| `description` | string | No | Description |
| `set_as_current` | boolean | No | Set this as the current update set (default true) |

**Behavior**:
1. Creates a new `sys_update_set` record with `state: "in progress"`
2. If `set_as_current` is true (default), updates the user's `sys_user_preference` to point to the new update set

---

**See also**: [Catalog Administration](./catalog-admin.md) · [Tools Overview](./README.md) · [Adding Tools](../development/adding-tools.md)
