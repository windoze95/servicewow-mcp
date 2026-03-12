[docs](../README.md) / [tools](./README.md) / knowledge

# Knowledge Tools (2)

Tools for searching and reading ServiceNow knowledge base articles.

## `search_knowledge`

Search knowledge base articles by keyword. Returns articles the user has access to.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search keywords |
| `limit` | number | No | Maximum results (1-50, default 10) |

**API**: Uses the Knowledge Management API (`/api/sn_km/knowledge/articles`) which respects knowledge base permissions and article visibility.

**Returns**: Article summaries with `self_link` URLs to the `kb_knowledge` table.

## `get_article`

Get full details of a knowledge article by sys_id.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Knowledge article sys_id |

**Validation**: sys_id must be a 32-character hex string.

**API**: Uses `/api/sn_km/knowledge/articles/{sys_id}` for full article content.

---

**See also**: [Users and Groups](./users-and-groups.md) · [Catalog](./catalog.md) · [Tools Overview](./README.md)
