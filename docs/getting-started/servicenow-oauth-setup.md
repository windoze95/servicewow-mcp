[docs](../README.md) / [getting-started](./README.md) / servicenow-oauth-setup

# ServiceNow OAuth Setup

This guide walks through creating the OAuth application in ServiceNow and assigning the required role to users.

## Create the OAuth Application

1. In your ServiceNow instance, navigate to **System OAuth > Application Registry**
2. Click **New** and select **Create an OAuth API endpoint for external clients**
3. Configure the application:

| Field | Value |
|---|---|
| **Name** | ServiceNow MCP Server (or any descriptive name) |
| **Redirect URL** | `https://<your-host>:8080/oauth/callback` |
| **Active** | Checked |

4. Save the record
5. Copy the **Client ID** and **Client Secret** into your `.env` file:

```bash
SERVICENOW_CLIENT_ID=<client_id>
SERVICENOW_CLIENT_SECRET=<client_secret>
```

> The redirect URI in `.env` (`OAUTH_REDIRECT_URI`) must **exactly** match the Redirect URL configured in ServiceNow. A mismatch causes `TOKEN_EXCHANGE_FAILED` errors. See [Troubleshooting](../troubleshooting/README.md).

## Assign the Required Role

Users who will authenticate through this server need the **`snc_platform_rest_api_access`** role to access ServiceNow REST APIs.

### Per-User Assignment

1. Navigate to **User Administration > Users**
2. Open the user record
3. In the **Roles** related list, click **Edit**
4. Add `snc_platform_rest_api_access`
5. Save

### Group-Based Assignment

For easier management, create a group (e.g., "MCP Users") and assign the role to the group:

1. Create a group at **User Administration > Groups**
2. Add `snc_platform_rest_api_access` to the group's roles
3. Add users as group members

### What This Role Does

- Grants access to the `/api/now/table/*` REST endpoints (when `glide.rest.enable_role_based_access` is enabled)
- Does **not** bypass record-level ACLs — each user's existing permissions still apply
- Does **not** grant admin access

## Verify the Setup

After completing OAuth (see [First Tool Call](./first-tool-call.md)), if API calls return 403 errors, the user is likely missing this role. See [Troubleshooting](../troubleshooting/README.md).

---

**See also**: [OAuth Flow](../auth/oauth-flow.md) · [Identity Enforcement](../security/identity-enforcement.md) · [First Tool Call](./first-tool-call.md)
