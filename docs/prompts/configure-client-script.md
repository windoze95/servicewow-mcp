[docs](../README.md) / [prompts](./README.md) / configure-client-script

# Configure Client Script

**Prompt name**: `configure_catalog_client_script`

Guide for creating onChange/onLoad/onSubmit client scripts with the g_form API.

## Overview

Client scripts run JavaScript in the user's browser when interacting with catalog forms. Use [`create_catalog_client_script`](../tools/catalog-admin.md#create_catalog_client_script) to create them.

## Prefer `validate_regex` for Simple Validation

Before writing a client script for input validation, consider using the `validate_regex` parameter on [`create_catalog_variable`](../tools/catalog-admin.md#create_catalog_variable) instead. It references a `question_regex` record and enforces format constraints declaratively.

**Use `validate_regex` when**: enforcing simple format rules (numeric-only, email format, IP address, phone number patterns).

**Use client scripts when**: you need cross-field validation, async lookups, dynamic option filtering, conditional logic, or custom error messages.

## Script Types

### onChange

Fires when a specific variable's value changes.

```javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
  if (isLoading || newValue === '') return;
  // your logic here
}
```

- **Must set `cat_variable`** to `IO:{variable_sys_id}`
- Check `isLoading` to avoid running on initial form load

### onLoad

Fires when the form first loads.

```javascript
function onLoad() {
  // your logic here
}
```

- No `cat_variable` needed

### onSubmit

Fires when the user submits the form.

```javascript
function onSubmit() {
  // return false to prevent submission
  // return true or undefined to allow
}
```

- Use for validation before submission

## Example

```
create_catalog_client_script({
  name: "Show warning on high priority",
  cat_item: item_sys_id,
  type: "onChange",
  cat_variable: "IO:{priority_var_sys_id}",
  script: "function onChange(control, oldValue, newValue, isLoading, isTemplate) {\n  if (isLoading || newValue === '') return;\n  if (newValue === 'high') {\n    g_form.addInfoMessage('High priority requests require manager approval.');\n  }\n}",
  ui_type: "All",
  active: true,
})
```

## `applies_to`: Targeting Catalog Items vs Variable Sets

- **`"A Catalog Item"`** (default): set `cat_item` to the catalog item sys_id
- **`"A Variable Set"`**: set `variable_set` to the variable set sys_id instead. The script applies wherever that set is attached.

## g_form API Reference

| Method | Description |
|---|---|
| `g_form.setValue(varName, value)` | Set a variable's value |
| `g_form.getValue(varName)` | Get a variable's current value |
| `g_form.setVisible(varName, bool)` | Show/hide a variable |
| `g_form.setMandatory(varName, bool)` | Set mandatory state |
| `g_form.setReadOnly(varName, bool)` | Set read-only state |
| `g_form.addInfoMessage(msg)` | Show info banner |
| `g_form.addErrorMessage(msg)` | Show error banner |
| `g_form.clearMessages()` | Clear all banners |
| `g_form.showFieldMsg(varName, msg, type)` | Inline field message (`type`: `"info"` or `"error"`) |
| `g_form.hideFieldMsg(varName)` | Clear inline field message |
| `g_form.getReference(varName, callback)` | Async-fetch reference record |
| `g_form.addOption(varName, value, label)` | Add dropdown option |
| `g_form.removeOption(varName, value)` | Remove dropdown option |
| `g_form.clearOptions(varName)` | Remove all dropdown options |

## Gotchas

- **`cat_variable` uses `IO:{sys_id}` format** for onChange scripts — not the variable name
- **Script must be a complete function**: include the full `function onChange(...) { }` wrapper
- **Newlines in script**: use `\n` in the JSON string or pass multiline strings
- **g_form variable names**: use the variable's `name` field (not sys_id) when calling `g_form.setValue()` etc.
- **`applies_catalog` / `applies_req_item`**: control whether the script runs on the ordering form and/or the requested item view

---

**See also**: [Configure UI Policy](./configure-ui-policy.md) · [Catalog Administration Tools](../tools/catalog-admin.md) · [Build Variable Set](./build-variable-set.md)
