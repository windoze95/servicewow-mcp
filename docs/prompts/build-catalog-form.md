[docs](../README.md) / [prompts](./README.md) / build-catalog-form

# Build Catalog Form

**Prompt name**: `build_catalog_form`

End-to-end guide for creating a catalog item with variables, choices, and two-column layout.

## Workflow Sequence

### Step 1: Create the Catalog Item

Use [`create_catalog_item`](../tools/catalog-admin.md#create_catalog_item) to create the form container. Capture the returned `sys_id` — every subsequent call needs it as `cat_item`.

```
create_catalog_item({
  name: "VPN Access Request",
  short_description: "Request VPN access for remote work",
  category: "<category_sys_id>",
  sc_catalogs: "<catalog_sys_id>",
})
→ save result.data.sys_id as item_sys_id
```

### Step 2: Add Variables (Form Fields)

Call [`create_catalog_variable`](../tools/catalog-admin.md#create_catalog_variable) once per field. Always set `cat_item` to the `item_sys_id` from Step 1.

**Ordering**: Use increments of 100 (100, 200, 300...) so fields can be inserted later.

```
create_catalog_variable({
  cat_item: item_sys_id,
  name: "justification",
  question_text: "Business Justification",
  type: "multi_line_text",
  mandatory: true,
  order: 100,
})
```

#### Two-Column Layout

Use container variables to create a two-column layout:

```
container_start  (order: 200)
  left_field     (order: 300)
container_split  (order: 400)
  right_field    (order: 500)
container_end    (order: 600)
```

Always include all three container types (`container_start`, `container_split`, `container_end`). Missing any piece breaks the layout.

### Step 3: Add Choices

For `select_box` or `multiple_choice` variables, call [`create_variable_choice`](../tools/catalog-admin.md#create_variable_choice) per option. The `question` field is the **variable's sys_id**.

```
create_variable_choice({ question: var_sys_id, text: "High",   value: "high",   order: 100 })
create_variable_choice({ question: var_sys_id, text: "Medium", value: "medium", order: 200 })
create_variable_choice({ question: var_sys_id, text: "Low",    value: "low",    order: 300 })
```

### Step 4: Verify

Call [`list_catalog_variables`](../tools/catalog-admin.md#list_catalog_variables) to confirm all fields and their order:

```
list_catalog_variables({ cat_item: item_sys_id })
```

## Common Gotchas

- **Reference types** (`reference`, `list_collector`): must set the `reference` parameter to the target table name (e.g., `sys_user`, `cmdb_ci`)
- **Choices are separate calls**: `select_box` and `multiple_choice` have no inline choice option
- **Order collisions**: if two variables share the same order, display order is unpredictable
- **Container layout**: always use the full pattern: `container_start` → fields → `container_split` → fields → `container_end`

## Variable Type Quick Reference

See the full [Variable Type Reference](../tools/catalog-admin.md#variable-type-reference) table.

---

**See also**: [Catalog Administration Tools](../tools/catalog-admin.md) · [Configure UI Policy](./configure-ui-policy.md) · [Configure Client Script](./configure-client-script.md)
