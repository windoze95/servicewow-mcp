[docs](../README.md) / [tools](./README.md) / catalog

# Service Catalog Tools (3)

Tools for browsing and ordering from the ServiceNow service catalog.

## `search_catalog_items`

Search the service catalog by keyword. Returns items the user has access to.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search keywords |
| `limit` | number | No | Maximum results (1-50, default 10) |

**API**: Uses the Service Catalog API (`/api/sn_sc/servicecatalog/items`) which respects catalog ACLs and user entitlements.

## `get_catalog_item`

Get full details and form variables for a catalog item.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Catalog item sys_id |

**Validation**: sys_id must be a 32-character hex string.

**API**: Uses `/api/sn_sc/servicecatalog/items/{sys_id}` which returns the item details along with its form variables.

## `submit_catalog_request`

Submit a request for a catalog item with variable values. Creates the request as the authenticated user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Catalog item sys_id |
| `variables` | object | No | Form variable values as key-value pairs (default `{}`) |
| `quantity` | number | No | Quantity to order (default 1) |

**API**: Uses `/api/sn_sc/servicecatalog/items/{sys_id}/order_now`.

**Identity enforcement**: The request is submitted using the authenticated user's OAuth token, so ServiceNow attributes it to that user. See [Identity Enforcement](../security/identity-enforcement.md).

---

**See also**: [Catalog Administration](./catalog-admin.md) · [Prompts](../prompts/README.md) · [Identity Enforcement](../security/identity-enforcement.md)
