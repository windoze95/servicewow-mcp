import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function buildCatalogFormPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Build a Catalog Form — End-to-End Guide

## Workflow Sequence

### Step 1: Create the Catalog Item (form container)

Use \`create_catalog_item\` to create the item. Capture the returned \`sys_id\` — every subsequent call needs it as \`cat_item\`.

\`\`\`
create_catalog_item({
  name: "VPN Access Request",
  short_description: "Request VPN access for remote work",
  category: "<category_sys_id>",          // optional
  sc_catalogs: "<catalog_sys_id>",        // optional, comma-separated
})
→ save result.data.sys_id as item_sys_id
\`\`\`

### Step 2: Add Variables (form fields)

Call \`create_catalog_variable\` once per field. Always set \`cat_item\` to the \`item_sys_id\` from Step 1.

**Ordering**: Use increments of 100 (100, 200, 300…) so fields can be inserted later.

\`\`\`
create_catalog_variable({
  cat_item: item_sys_id,
  name: "justification",
  question_text: "Business Justification",
  type: "multi_line_text",
  mandatory: true,
  order: 100,
})
→ save result.data.sys_id as var_justification_sys_id
\`\`\`

**Two-column layout** uses container variables:

\`\`\`
create_catalog_variable({ cat_item, name: "layout_start", question_text: "Layout", type: "container_start", order: 200 })
create_catalog_variable({ cat_item, name: "left_field",   question_text: "Left Field",  type: "single_line_text", order: 300 })
create_catalog_variable({ cat_item, name: "layout_split", question_text: "Split",  type: "container_split", order: 400 })
create_catalog_variable({ cat_item, name: "right_field",  question_text: "Right Field", type: "single_line_text", order: 500 })
create_catalog_variable({ cat_item, name: "layout_end",   question_text: "End",    type: "container_end",   order: 600 })
\`\`\`

### Step 3: Add Choices (for select_box / multiple_choice variables)

For each \`select_box\` or \`multiple_choice\` variable, call \`create_variable_choice\` per option. The \`question\` field is the **variable's sys_id**.

\`\`\`
create_variable_choice({ question: var_priority_sys_id, text: "High",   value: "high",   order: 100 })
create_variable_choice({ question: var_priority_sys_id, text: "Medium", value: "medium", order: 200 })
create_variable_choice({ question: var_priority_sys_id, text: "Low",    value: "low",    order: 300 })
\`\`\`

## Variable Type Quick Reference

| Type Key | Code | Notes |
|---|---|---|
| yes_no | 1 | Boolean toggle |
| multi_line_text | 2 | Textarea |
| multiple_choice | 3 | Radio buttons — needs choices |
| numeric_scale | 4 | Scale slider |
| select_box | 5 | Dropdown — needs choices |
| single_line_text | 6 | Standard text input |
| checkbox | 7 | Single checkbox |
| reference | 8 | Reference field — set \`reference\` to table name |
| date | 9 | Date picker |
| date_time | 10 | Date + time picker |
| label | 11 | Read-only label |
| break | 12 | Horizontal rule |
| macro | 14 | UI macro |
| macro_with_label | 15 | UI macro with label |
| wide_single_line_text | 16 | Full-width text input |
| lookup_select_box | 17 | Lookup dropdown |
| container_start | 18 | Start two-column layout |
| container_end | 19 | End two-column layout |
| list_collector | 20 | Multi-select list — set \`reference\` to table name |
| lookup_multiple_choice | 21 | Lookup radio buttons |
| container_split | 22 | Split between columns |
| requested_for | 23 | Requested-for picker |
| ip_address | 24 | IP address input |
| duration | 25 | Duration picker |
| email | 26 | Email input |
| url | 27 | URL input |
| html | 28 | HTML content |
| attachment | 29 | File upload |
| rich_text_label | 30 | Rich text display |
| custom | 31 | Custom widget |
| custom_with_label | 32 | Custom widget with label |

## Common Gotchas

- **Reference types** (reference, list_collector): you must set the \`reference\` parameter to the target table name (e.g., "sys_user", "cmdb_ci").
- **Choices are separate calls**: \`select_box\` and \`multiple_choice\` variables have no inline choice option — use \`create_variable_choice\` for each.
- **Container layout**: always use the pattern \`container_start\` → fields → \`container_split\` → fields → \`container_end\`. Missing any piece breaks the layout.
- **Order collisions**: if two variables share the same order value, display order is unpredictable.
- **Verify with list_catalog_variables**: after building, call \`list_catalog_variables({ cat_item: item_sys_id })\` to confirm all fields and their order.`,
        },
      },
    ],
  };
}

function configureCatalogUIPolicyPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Configure Catalog UI Policies — Guide

## Overview

UI policies declaratively control field visibility, mandatory state, and disabled state based on variable values — no scripting required for common patterns.

## Workflow Sequence

### Step 1: Create the UI Policy

Use \`create_catalog_ui_policy\`. The key field is \`catalog_conditions\`, which uses the \`IO:{var_sys_id}\` format to reference catalog variables.

\`\`\`
create_catalog_ui_policy({
  short_description: "Show details when priority is High",
  catalog_item: item_sys_id,
  catalog_conditions: "IO:{priority_var_sys_id}=high^EQ",
  on_load: true,
  reverse_if_false: true,
  order: 100,
})
→ save result.data.sys_id as policy_sys_id
\`\`\`

**Condition syntax**: \`IO:{variable_sys_id}=value^EQ\`
- \`IO:\` prefix is required for catalog variables
- \`{variable_sys_id}\` is the 32-char sys_id of the variable (not the name)
- Standard operators: \`=\`, \`!=\`, \`IN\`, \`NOTIN\`, \`ISEMPTY\`, \`ISNOTEMPTY\`
- Chain with \`^\` (AND) or \`^OR\` (OR), terminate with \`^EQ\`

**Multiple conditions example**:
\`\`\`
"IO:{type_var_sys_id}=hardware^IO:{priority_var_sys_id}=high^EQ"
\`\`\`

### Step 2: Add Policy Actions

Call \`create_catalog_ui_policy_action\` for each variable the policy should affect. The \`catalog_variable\` field also uses \`IO:{sys_id}\` format.

\`\`\`
create_catalog_ui_policy_action({
  ui_policy: policy_sys_id,
  catalog_variable: "IO:{details_var_sys_id}",
  visible: "true",
  mandatory: "true",
  disabled: "Leave alone",
})
\`\`\`

**Action values** are strings, not booleans:
- \`"true"\` — enforce the state
- \`"false"\` — enforce the opposite
- \`"Leave alone"\` — don't change this property

### reverse_if_false Behavior

When \`reverse_if_false: true\` (default):
- **Condition TRUE**: actions apply as configured
- **Condition FALSE**: actions are reversed (visible "true" → field hidden, mandatory "true" → field optional)

When \`reverse_if_false: false\`:
- **Condition TRUE**: actions apply
- **Condition FALSE**: nothing changes (field stays in whatever state it was)

## Common Patterns

### Show/hide field based on dropdown
1. Create policy: condition = \`IO:{dropdown_sys_id}=specific_value^EQ\`
2. Add action: \`catalog_variable: "IO:{target_field_sys_id}", visible: "true"\`
3. With \`reverse_if_false: true\`, the target field auto-hides when the dropdown changes away from the trigger value.

### Conditional mandatory
1. Create policy: condition = \`IO:{checkbox_sys_id}=true^EQ\`
2. Add action: \`catalog_variable: "IO:{text_field_sys_id}", mandatory: "true"\`
3. Field becomes required only when checkbox is checked.

### Multiple actions on one policy
Create multiple \`create_catalog_ui_policy_action\` calls with the same \`ui_policy\` sys_id but different \`catalog_variable\` values. All actions fire together when the condition matches.

## Gotchas

- **IO: prefix is required** in both \`catalog_conditions\` and \`catalog_variable\`. Without it, the policy silently fails.
- **Action values are strings**: use \`"true"\` / \`"false"\` / \`"Leave alone"\`, not boolean \`true\`/\`false\`.
- **Condition must end with \`^EQ\`** (or appropriate terminator).
- **Order matters**: lower order = higher priority when policies conflict.`,
        },
      },
    ],
  };
}

function configureCatalogClientScriptPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Configure Catalog Client Scripts — Guide

## Overview

Client scripts run JavaScript in the user's browser when interacting with catalog forms. Use \`create_catalog_client_script\` to create them.

## Script Types and Function Signatures

### onChange — fires when a specific variable value changes
\`\`\`javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
  if (isLoading || newValue === '') return;
  // your logic here
}
\`\`\`
- **Must set \`cat_variable\`** to \`IO:{variable_sys_id}\` to specify which variable triggers the script.
- \`control\` is the DOM element, \`oldValue\`/\`newValue\` are the values.
- Check \`isLoading\` to avoid running on initial form load.

### onLoad — fires when the form first loads
\`\`\`javascript
function onLoad() {
  // your logic here
}
\`\`\`
- Runs once when the catalog form renders.
- No \`cat_variable\` needed.

### onSubmit — fires when the user submits the form
\`\`\`javascript
function onSubmit() {
  // return false to prevent submission
  // return true or undefined to allow
}
\`\`\`
- Use for validation before submission.
- Return \`false\` to block the submit.

## Usage

\`\`\`
create_catalog_client_script({
  name: "Show warning on high priority",
  cat_item: item_sys_id,
  type: "onChange",
  cat_variable: "IO:{priority_var_sys_id}",
  script: "function onChange(control, oldValue, newValue, isLoading, isTemplate) {\\n  if (isLoading || newValue === '') return;\\n  if (newValue === 'high') {\\n    g_form.addInfoMessage('High priority requests require manager approval.');\\n  }\\n}",
  ui_type: "All",
  active: true,
})
\`\`\`

## applies_to: Targeting Catalog Items vs Variable Sets

- **\`"A Catalog Item"\`** (default): set \`cat_item\` to the catalog item sys_id.
- **\`"A Variable Set"\`**: set \`variable_set\` to the variable set sys_id instead. The script applies wherever that set is attached.

## Common g_form API Methods

| Method | Description |
|---|---|
| \`g_form.setValue(varName, value)\` | Set a variable's value |
| \`g_form.getValue(varName)\` | Get a variable's current value |
| \`g_form.setVisible(varName, bool)\` | Show/hide a variable |
| \`g_form.setMandatory(varName, bool)\` | Set mandatory state |
| \`g_form.setReadOnly(varName, bool)\` | Set read-only state |
| \`g_form.addInfoMessage(msg)\` | Show info banner |
| \`g_form.addErrorMessage(msg)\` | Show error banner |
| \`g_form.clearMessages()\` | Clear all banners |
| \`g_form.showFieldMsg(varName, msg, type)\` | Inline field message (\`type\`: "info" or "error") |
| \`g_form.hideFieldMsg(varName)\` | Clear inline field message |
| \`g_form.getReference(varName, callback)\` | Async-fetch reference record |
| \`g_form.addOption(varName, value, label)\` | Add dropdown option |
| \`g_form.removeOption(varName, value)\` | Remove dropdown option |
| \`g_form.clearOptions(varName)\` | Remove all dropdown options |

## Gotchas

- **\`cat_variable\` uses \`IO:{sys_id}\` format** for onChange scripts — this references the variable by sys_id, not by name.
- **Script must be a complete function**: include the full \`function onChange(...) { }\` wrapper.
- **Newlines in script**: use \`\\n\` in the JSON string or pass multiline strings.
- **g_form variable names**: use the variable's \`name\` field (not sys_id) when calling \`g_form.setValue()\` etc.
- **applies_catalog / applies_req_item**: control whether the script runs on the ordering form and/or the requested item view.`,
        },
      },
    ],
  };
}

function buildCatalogVariableSetPrompt() {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Build a Catalog Variable Set — Guide

## Overview

Variable sets are reusable collections of variables that can be attached to multiple catalog items. Instead of recreating the same fields on every item, define them once in a set.

## Workflow Sequence

### Step 1: Create the Variable Set

Use \`create_variable_set\` to create the set. Choose the type based on your use case.

\`\`\`
create_variable_set({
  title: "Contact Information",
  internal_name: "contact_info",
  type: "one_to_one",
  description: "Standard contact fields for requesters",
  order: 100,
})
→ save result.data.sys_id as set_sys_id
\`\`\`

**Set types**:
- **one_to_one** (Single Row, default): variables display inline on the form, same as direct variables. Use for reusable field groups (e.g., contact info, approval details).
- **one_to_many** (Multi Row): displays as an embedded list/grid where users can add multiple rows. Use for line items (e.g., hardware order lines, user lists).

### Step 2: Attach the Variable Set to a Catalog Item

Use \`attach_variable_set\` to create the M2M relationship. Both sys_ids are required.

\`\`\`
attach_variable_set({
  sc_cat_item: item_sys_id,
  variable_set: set_sys_id,
  order: 200,
})
\`\`\`

You can attach the same set to multiple catalog items by calling \`attach_variable_set\` once per item.

### Step 3: Add Variables to the Set

**Important**: Variables are added to variable sets through the ServiceNow UI, not through the \`create_catalog_variable\` tool. The \`create_catalog_variable\` tool requires a \`cat_item\` parameter and creates variables directly on catalog items.

To add variables to a set, use the ServiceNow platform:
1. Navigate to the variable set record
2. Use the "Variables" related list to add new variables

## When to Use Variable Sets vs Direct Variables

**Use variable sets when**:
- The same group of fields appears on 3+ catalog items
- You want consistent field definitions across items
- A change to the fields should propagate to all items using the set
- You need multi-row (one_to_many) data entry

**Use direct variables when**:
- Fields are unique to one catalog item
- You need full control over field ordering relative to other fields
- The form is simple and reuse isn't needed

## Verifying the Setup

After attaching a set, use \`list_catalog_variables\` with \`include_set_variables: true\` to confirm the set's variables appear:

\`\`\`
list_catalog_variables({
  cat_item: item_sys_id,
  include_set_variables: true,
})
\`\`\`

## Gotchas

- **Variables can't be added to sets via the API tools**: the \`create_catalog_variable\` tool targets catalog items (\`cat_item\`), not variable sets. Use the ServiceNow UI for set variables.
- **Ordering**: the set's \`order\` on the attachment controls where the set's variables appear relative to direct variables and other sets.
- **Detaching**: there is no detach tool — remove the M2M record (\`io_set_item\`) through the ServiceNow UI if needed.
- **one_to_many sets**: each row is a separate record; they work differently from single-row variables in scripts and conditions.`,
        },
      },
    ],
  };
}

export function registerCatalogPrompts(server: McpServer): void {
  server.prompt(
    "build_catalog_form",
    "End-to-end guide for creating a catalog item with variables, choices, and two-column layout",
    () => buildCatalogFormPrompt()
  );

  server.prompt(
    "configure_catalog_ui_policy",
    "Guide for setting up UI policies with IO:{sys_id} conditions and field-level actions",
    () => configureCatalogUIPolicyPrompt()
  );

  server.prompt(
    "configure_catalog_client_script",
    "Guide for onChange/onLoad/onSubmit client scripts with g_form API reference",
    () => configureCatalogClientScriptPrompt()
  );

  server.prompt(
    "build_catalog_variable_set",
    "Guide for creating and attaching reusable variable sets to catalog items",
    () => buildCatalogVariableSetPrompt()
  );
}
