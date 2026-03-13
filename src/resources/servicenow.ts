import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ToolContext } from "../tools/registry.js";
import { validateSysId, validateIncidentNumber, validateChangeNumber } from "../utils/validators.js";
import type {
  ServiceNowSingleResponse,
  ServiceNowListResponse,
  User,
  Incident,
  ChangeRequest,
  KnowledgeArticle,
  CatalogItem,
} from "../servicenow/types.js";
import { logger } from "../utils/logger.js";

type GetContext = (extra?: { authInfo?: AuthInfo }) => Promise<ToolContext>;

export function registerResources(
  server: McpServer,
  getContext: GetContext
): void {
  // Fixed resource — current user profile
  server.resource(
    "my_profile",
    "servicenow://me",
    { description: "Current authenticated user's ServiceNow profile" },
    async (uri, extra) => {
      try {
        const ctx = await getContext(extra);
        const { data } = await ctx.snClient.get<ServiceNowSingleResponse<User>>(
          `/api/now/table/sys_user/${ctx.userSysId}`
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(data.result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error({ error, uri: uri.href }, "Resource read failed");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: (error as { message?: string })?.message || "Failed to read resource",
              }),
            },
          ],
        };
      }
    }
  );

  // Template resource — incident by number (INC...) or sys_id
  server.resource(
    "incident",
    new ResourceTemplate("servicenow://incident/{identifier}", { list: undefined }),
    { description: "ServiceNow incident record by number (INC...) or sys_id" },
    async (uri, variables, extra) => {
      const identifier = variables.identifier as string;
      try {
        const ctx = await getContext(extra);
        let result: Incident;

        if (validateIncidentNumber(identifier)) {
          const { data } = await ctx.snClient.get<ServiceNowListResponse<Incident>>(
            "/api/now/table/incident",
            { params: { sysparm_query: `number=${identifier}`, sysparm_limit: 1 } }
          );
          if (!data.result.length) {
            return {
              contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: `Incident not found: ${identifier}` }) }],
            };
          }
          result = data.result[0];
        } else if (validateSysId(identifier)) {
          const { data } = await ctx.snClient.get<ServiceNowSingleResponse<Incident>>(
            `/api/now/table/incident/${identifier}`
          );
          result = data.result;
        } else {
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: "Invalid identifier. Provide an incident number (INC...) or 32-character sys_id." }) }],
          };
        }

        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error({ error, uri: uri.href }, "Resource read failed");
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: (error as { message?: string })?.message || "Failed to read resource" }) }],
        };
      }
    }
  );

  // Template resource — change_request by number (CHG...) or sys_id
  server.resource(
    "change_request",
    new ResourceTemplate("servicenow://change_request/{identifier}", { list: undefined }),
    { description: "ServiceNow change request record by number (CHG...) or sys_id" },
    async (uri, variables, extra) => {
      const identifier = variables.identifier as string;
      try {
        const ctx = await getContext(extra);
        let result: ChangeRequest;

        if (validateChangeNumber(identifier)) {
          const { data } = await ctx.snClient.get<ServiceNowListResponse<ChangeRequest>>(
            "/api/now/table/change_request",
            { params: { sysparm_query: `number=${identifier}`, sysparm_limit: 1 } }
          );
          if (!data.result.length) {
            return {
              contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: `Change request not found: ${identifier}` }) }],
            };
          }
          result = data.result[0];
        } else if (validateSysId(identifier)) {
          const { data } = await ctx.snClient.get<ServiceNowSingleResponse<ChangeRequest>>(
            `/api/now/table/change_request/${identifier}`
          );
          result = data.result;
        } else {
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: "Invalid identifier. Provide a change number (CHG...) or 32-character sys_id." }) }],
          };
        }

        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error({ error, uri: uri.href }, "Resource read failed");
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: (error as { message?: string })?.message || "Failed to read resource" }) }],
        };
      }
    }
  );

  // Template resource — knowledge article by sys_id
  server.resource(
    "kb_knowledge",
    new ResourceTemplate("servicenow://kb_knowledge/{sys_id}", { list: undefined }),
    { description: "ServiceNow knowledge base article by sys_id" },
    async (uri, variables, extra) => {
      const sysId = variables.sys_id as string;
      try {
        if (!validateSysId(sysId)) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({ error: "Invalid sys_id format" }),
              },
            ],
          };
        }
        const ctx = await getContext(extra);
        const { data } = await ctx.snClient.get<ServiceNowSingleResponse<KnowledgeArticle>>(
          `/api/sn_km/knowledge/articles/${sysId}`
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(data.result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error({ error, uri: uri.href }, "Resource read failed");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: (error as { message?: string })?.message || "Failed to read resource",
              }),
            },
          ],
        };
      }
    }
  );

  // Template resource — catalog item by sys_id
  server.resource(
    "catalog",
    new ResourceTemplate("servicenow://catalog/{sys_id}", { list: undefined }),
    { description: "ServiceNow service catalog item by sys_id" },
    async (uri, variables, extra) => {
      const sysId = variables.sys_id as string;
      try {
        if (!validateSysId(sysId)) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({ error: "Invalid sys_id format" }),
              },
            ],
          };
        }
        const ctx = await getContext(extra);
        const { data } = await ctx.snClient.get<ServiceNowSingleResponse<CatalogItem>>(
          `/api/sn_sc/servicecatalog/items/${sysId}`
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(data.result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error({ error, uri: uri.href }, "Resource read failed");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: (error as { message?: string })?.message || "Failed to read resource",
              }),
            },
          ],
        };
      }
    }
  );

  logger.info("All resources registered");
}
