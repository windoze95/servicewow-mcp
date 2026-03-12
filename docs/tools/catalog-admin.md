[docs](../README.md) / [tools](./README.md) / catalog-admin

# Catalog Administration Tools (11)

Tools for building and managing service catalog items, variables, choices, scripts, and UI policies.

For guided workflows using these tools, see the [Prompts](../prompts/README.md) section.

## `create_catalog_item`

Create a new service catalog item (form container).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Catalog item name |
| `short_description` | string | Yes | Brief description |
| `description` | string | No | Full HTML description |
| `category` | string | No | Category sys_id or name |
| `sc_catalogs` | string | No | Catalog sys_id(s), comma-separated |
| `group` | string | No | Fulfillment group sys_id or name |
| `active` | boolean | No | Active state (default true) |
| `no_cart` | boolean | No | Hide "Add to Cart" |
| `no_quantity` | boolean | No | Hide quantity selector |
| `workflow` | string | No | Workflow sys_id |

## `update_catalog_item`

Update fields on an existing catalog item.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Catalog item sys_id |
| `fields` | object | Yes | Fields to update (e.g., `{ "active": false }`) |

**Payload sanitization**: Read-only fields are stripped. See [Input Validation](../security/input-validation.md).

## `create_catalog_variable`

Create a form variable (field) on a catalog item.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cat_item` | string | Yes | Catalog item sys_id |
| `name` | string | Yes | Internal variable name |
| `question_text` | string | Yes | Label shown to the user |
| `type` | string | Yes | Variable type (see [type table](#variable-type-reference) below) |
| `mandatory` | boolean | No | Required field (default false) |
| `order` | number | No | Display order |
| `default_value` | string | No | Default value |
| `reference` | string | No | Reference table name (for `reference`/`list_collector` types) |
| `reference_qual` | string | No | Reference qualifier filter |
| `help_text` | string | No | Help text |
| `hidden` | boolean | No | Hidden (default false) |
| `read_only` | boolean | No | Read only (default false) |

## `update_catalog_variable`

Update fields on an existing catalog variable.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Variable sys_id |
| `fields` | object | Yes | Fields to update |

## `list_catalog_variables`

List variables (form fields) for a catalog item, ordered by display order.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cat_item` | string | Yes | Catalog item sys_id |
| `include_set_variables` | boolean | No | Also include variables from attached variable sets (default false) |
| `limit` | number | No | Maximum results (1-200, default 50) |

**Returns**: Direct variables and optionally set variables, each with `sys_id`, `name`, `question_text`, `type`, `mandatory`, `order`, and `self_link`.

## `create_variable_choice`

Create a choice option for a `select_box` or `multiple_choice` variable.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `question` | string | Yes | Variable sys_id |
| `text` | string | Yes | Display text |
| `value` | string | Yes | Stored value |
| `order` | number | No | Display order |

## `create_variable_set`

Create a reusable variable set that can be attached to multiple catalog items.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Display name |
| `internal_name` | string | Yes | Internal identifier |
| `type` | string | No | `one_to_one` (Single Row, default) or `one_to_many` (Multi Row) |
| `description` | string | No | Description |
| `order` | number | No | Display order |

## `attach_variable_set`

Attach a variable set to a catalog item via the M2M table (`io_set_item`).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sc_cat_item` | string | Yes | Catalog item sys_id |
| `variable_set` | string | Yes | Variable set sys_id |
| `order` | number | No | Display order |

## `create_catalog_client_script`

Create a client-side script (onChange/onLoad/onSubmit) for a catalog item or variable set.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Script name |
| `cat_item` | string | Conditional | Catalog item sys_id (required unless `applies_to` is `A Variable Set`) |
| `type` | string | Yes | `onChange`, `onLoad`, or `onSubmit` |
| `script` | string | Yes | JavaScript function body |
| `cat_variable` | string | No | Variable name for onChange (`IO:{sys_id}` format) |
| `applies_to` | string | No | `A Catalog Item` (default) or `A Variable Set` |
| `variable_set` | string | No | Variable set sys_id (when targeting a set) |
| `ui_type` | string | No | `All` (default), `Desktop`, or `Mobile` |
| `active` | boolean | No | Active (default true) |
| `applies_catalog` | boolean | No | Applies on catalog item view (default true) |
| `applies_req_item` | boolean | No | Applies on requested items (default false) |

See [Configure Client Script](../prompts/configure-client-script.md) for the full guide.

## `update_catalog_client_script`

Update fields on an existing catalog client script.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Client script sys_id |
| `fields` | object | Yes | Fields to update (e.g. `{ active: false }`) |

## `create_catalog_ui_policy`

Create a UI policy (declarative show/hide/mandatory rules) for a catalog item or variable set.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `short_description` | string | Yes | Policy name |
| `catalog_item` | string | Conditional | Catalog item sys_id (required unless `applies_to` is `A Variable Set`) |
| `catalog_conditions` | string | Yes | Variable conditions (e.g., `IO:{var_sys_id}=value^EQ`) |
| `on_load` | boolean | No | Run on form load (default true) |
| `reverse_if_false` | boolean | No | Reverse actions when condition false (default true) |
| `order` | number | No | Evaluation order (default 100) |
| `applies_to` | string | No | `A Catalog Item` (default) or `A Variable Set` |
| `variable_set` | string | No | Variable set sys_id |
| `ui_type` | string | No | `Desktop` (default), `Mobile`, or `Both` |
| `run_scripts` | boolean | No | Execute script (default false) |
| `script_true` | string | No | JavaScript when condition true |
| `script_false` | string | No | JavaScript when condition false |
| `active` | boolean | No | Active (default true) |

See [Configure UI Policy](../prompts/configure-ui-policy.md) for the full guide.

## `create_catalog_ui_policy_action`

Create a field action within a catalog UI policy.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ui_policy` | string | Yes | UI policy sys_id |
| `catalog_variable` | string | Yes | Variable identifier (`IO:{sys_id}` format) |
| `visible` | string | No | `"true"`, `"false"`, or `"Leave alone"` |
| `mandatory` | string | No | `"true"`, `"false"`, or `"Leave alone"` |
| `disabled` | string | No | `"true"`, `"false"`, or `"Leave alone"` |
| `cleared` | boolean | No | Clear value when hidden (default false) |

> **Note**: `visible`, `mandatory`, and `disabled` are **strings**, not booleans.

## Variable Type Reference

| Type Key | Code | Notes |
|---|---|---|
| `yes_no` | 1 | Boolean toggle |
| `multi_line_text` | 2 | Textarea |
| `multiple_choice` | 3 | Radio buttons — needs choices |
| `numeric_scale` | 4 | Scale slider |
| `select_box` | 5 | Dropdown — needs choices |
| `single_line_text` | 6 | Standard text input |
| `checkbox` | 7 | Single checkbox |
| `reference` | 8 | Reference field — set `reference` param |
| `date` | 9 | Date picker |
| `date_time` | 10 | Date + time picker |
| `label` | 11 | Read-only label |
| `break` | 12 | Horizontal rule |
| `macro` | 14 | UI macro |
| `macro_with_label` | 15 | UI macro with label |
| `wide_single_line_text` | 16 | Full-width text input |
| `lookup_select_box` | 17 | Lookup dropdown |
| `container_start` | 18 | Start two-column layout |
| `container_end` | 19 | End two-column layout |
| `list_collector` | 20 | Multi-select list — set `reference` param |
| `lookup_multiple_choice` | 21 | Lookup radio buttons |
| `container_split` | 22 | Split between columns |
| `requested_for` | 23 | Requested-for picker |
| `ip_address` | 24 | IP address input |
| `duration` | 25 | Duration picker |
| `email` | 26 | Email input |
| `url` | 27 | URL input |
| `html` | 28 | HTML content |
| `attachment` | 29 | File upload |
| `rich_text_label` | 30 | Rich text display |
| `custom` | 31 | Custom widget |
| `custom_with_label` | 32 | Custom widget with label |

---

**See also**: [Catalog](./catalog.md) · [Prompts](../prompts/README.md) · [Build Catalog Form](../prompts/build-catalog-form.md)
