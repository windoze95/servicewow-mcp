import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import axios from "axios";
import { type Config } from "../config.js";
import { TokenStore, type StoredToken } from "./tokenStore.js";
import { logger } from "../utils/logger.js";

export function createOAuthRouter(
  config: Config,
  tokenStore: TokenStore
): Router {
  const router = Router();

  // GET /oauth/authorize — redirect user to ServiceNow OAuth
  router.get("/oauth/authorize", async (req: Request, res: Response) => {
    const state = crypto.randomBytes(32).toString("hex");
    const sessionId = (req.query.session_id as string) || "";

    await tokenStore.storeOAuthState(state, { sessionId });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.SERVICENOW_CLIENT_ID,
      redirect_uri: config.OAUTH_REDIRECT_URI,
      state,
    });

    const authorizeUrl = `${config.SERVICENOW_INSTANCE_URL}/oauth_auth.do?${params.toString()}`;
    logger.info("Redirecting to ServiceNow OAuth");
    res.redirect(authorizeUrl);
  });

  // GET /oauth/callback — exchange code for tokens
  router.get("/oauth/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
      logger.error({ error }, "OAuth error from ServiceNow");
      res.status(400).json({
        success: false,
        error: {
          code: "OAUTH_ERROR",
          message: `OAuth error: ${error}`,
        },
      });
      return;
    }

    if (!code || !state) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_CALLBACK",
          message: "Missing code or state parameter",
        },
      });
      return;
    }

    // Verify state (CSRF protection)
    const stateData = await tokenStore.getOAuthState(state as string);
    if (!stateData) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_STATE",
          message: "Invalid or expired OAuth state. Please try again.",
        },
      });
      return;
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post(
        `${config.SERVICENOW_INSTANCE_URL}/oauth_token.do`,
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: config.OAUTH_REDIRECT_URI,
          client_id: config.SERVICENOW_CLIENT_ID,
          client_secret: config.SERVICENOW_CLIENT_SECRET,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Look up user identity
      const userResponse = await axios.get(
        `${config.SERVICENOW_INSTANCE_URL}/api/now/table/sys_user`,
        {
          params: {
            sysparm_query: `user_name=${tokenResponse.data.scope?.split(":")?.[0] || ""}`,
            sysparm_limit: 1,
            sysparm_fields: "sys_id,user_name,name,email",
          },
          headers: {
            Authorization: `Bearer ${access_token}`,
            Accept: "application/json",
          },
        }
      );

      // If scope-based lookup fails, use the /api/now/table/sys_user endpoint with the token
      let userInfo: { sys_id: string; user_name: string; name: string };

      if (userResponse.data?.result?.length > 0) {
        userInfo = userResponse.data.result[0];
      } else {
        // Fall back to getting user info from a different endpoint
        const meResponse = await axios.get(
          `${config.SERVICENOW_INSTANCE_URL}/api/now/table/sys_user`,
          {
            params: {
              sysparm_query: "user_nameISNOTEMPTY",
              sysparm_limit: 1,
              sysparm_fields: "sys_id,user_name,name,email",
            },
            headers: {
              Authorization: `Bearer ${access_token}`,
              Accept: "application/json",
            },
          }
        );

        if (!meResponse.data?.result?.length) {
          throw new Error("Unable to determine user identity");
        }
        userInfo = meResponse.data.result[0];
      }

      const storedToken: StoredToken = {
        access_token,
        refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (expires_in || 1800),
        user_sys_id: userInfo.sys_id,
        user_name: userInfo.user_name,
        display_name: userInfo.name,
      };

      await tokenStore.storeToken(storedToken);

      // Map session to user if session ID was provided
      if (stateData.sessionId) {
        await tokenStore.storeSessionMapping(
          stateData.sessionId,
          userInfo.sys_id
        );
      }

      logger.info(
        { userName: userInfo.user_name },
        "OAuth authentication successful"
      );

      res.status(200).json({
        success: true,
        message: `Authentication successful for ${userInfo.name}. You can now use MCP tools.`,
        user: {
          sys_id: userInfo.sys_id,
          user_name: userInfo.user_name,
          display_name: userInfo.name,
        },
      });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      logger.error(
        { err: axiosErr.response?.data || axiosErr.message },
        "OAuth token exchange failed"
      );
      res.status(500).json({
        success: false,
        error: {
          code: "TOKEN_EXCHANGE_FAILED",
          message: "Failed to exchange authorization code for tokens",
        },
      });
    }
  });

  return router;
}
