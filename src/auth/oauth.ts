import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import axios from "axios";
import { type Config } from "../config.js";
import { TokenStore, type StoredToken } from "./tokenStore.js";
import { logger } from "../utils/logger.js";

const AUTH_CODE_TTL = 300; // 5 minutes

export function createOAuthRouter(
  config: Config,
  tokenStore: TokenStore
): Router {
  const router = Router();

  // GET /oauth/sn-callback — ServiceNow redirects here after user authorizes (SDK flow)
  router.get("/sn-callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
      logger.error({ error }, "ServiceNow OAuth error (SDK flow)");

      // Try to redirect the error back to the MCP client's redirect_uri
      // so the client gets a deterministic OAuth error instead of hanging.
      if (state) {
        const snStateData = await tokenStore.getSnState(state as string);
        if (snStateData) {
          const pendingAuth = await tokenStore.getPendingAuth(snStateData.pendingAuthId);
          if (pendingAuth) {
            await tokenStore.deletePendingAuth(snStateData.pendingAuthId);
            const redirectUrl = new URL(pendingAuth.redirectUri);
            redirectUrl.searchParams.set("error", error as string);
            if (pendingAuth.state) {
              redirectUrl.searchParams.set("state", pendingAuth.state);
            }
            res.redirect(redirectUrl.toString());
            return;
          }
        }
      }

      // Fallback: no state or lookup failed — can't redirect
      res.status(400).json({
        success: false,
        error: { code: "SN_OAUTH_ERROR", message: `ServiceNow OAuth error: ${error}` },
      });
      return;
    }

    if (!code || !state) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_CALLBACK", message: "Missing code or state parameter" },
      });
      return;
    }

    // Look up SN state → pending auth ID
    const snStateData = await tokenStore.getSnState(state as string);
    if (!snStateData) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_STATE", message: "Invalid or expired OAuth state" },
      });
      return;
    }

    const pendingAuth = await tokenStore.getPendingAuth(snStateData.pendingAuthId);
    if (!pendingAuth) {
      res.status(400).json({
        success: false,
        error: { code: "EXPIRED_AUTH", message: "Authorization request expired. Please try again." },
      });
      return;
    }

    try {
      // Exchange SN code for SN tokens (same logic as /callback)
      const tokenResponse = await axios.post(
        `${config.SERVICENOW_INSTANCE_URL}/oauth_token.do`,
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: config.SN_CALLBACK_URI,
          client_id: config.SERVICENOW_CLIENT_ID,
          client_secret: config.SERVICENOW_CLIENT_SECRET,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Resolve SN user identity
      const userResponse = await axios.get(
        `${config.SERVICENOW_INSTANCE_URL}/api/now/table/sys_user`,
        {
          params: {
            sysparm_query: "user_name=javascript:gs.getUserName()",
            sysparm_limit: 1,
            sysparm_fields: "sys_id,user_name,name,email",
          },
          headers: {
            Authorization: `Bearer ${access_token}`,
            Accept: "application/json",
          },
        }
      );

      if (!userResponse.data?.result?.length) {
        throw new Error("Unable to determine user identity from access token");
      }

      const currentUser = userResponse.data.result[0];
      const userInfo = {
        sys_id: currentUser.sys_id as string,
        user_name: currentUser.user_name as string,
        name: (currentUser.name || currentUser.user_name) as string,
      };

      // Store SN token
      const storedToken: StoredToken = {
        access_token,
        refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (expires_in || 1800),
        user_sys_id: userInfo.sys_id,
        user_name: userInfo.user_name,
        display_name: userInfo.name,
      };
      await tokenStore.storeToken(storedToken);

      // Generate our authorization code for the MCP client
      const authCode = crypto.randomBytes(32).toString("hex");
      await tokenStore.storeAuthCode(authCode, {
        userSysId: userInfo.sys_id,
        clientId: pendingAuth.clientId,
        codeChallenge: pendingAuth.codeChallenge,
        redirectUri: pendingAuth.redirectUri,
        scopes: pendingAuth.scopes ?? [],
      }, AUTH_CODE_TTL);

      // Clean up pending auth
      await tokenStore.deletePendingAuth(snStateData.pendingAuthId);

      // Redirect back to MCP client with our auth code
      const redirectUrl = new URL(pendingAuth.redirectUri);
      redirectUrl.searchParams.set("code", authCode);
      if (pendingAuth.state) {
        redirectUrl.searchParams.set("state", pendingAuth.state);
      }

      logger.info({ userName: userInfo.user_name }, "OAuth SN callback successful, redirecting to MCP client");
      res.redirect(redirectUrl.toString());
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      logger.error(
        { err: axiosErr.response?.data || axiosErr.message },
        "SN callback token exchange failed"
      );
      // Clean up orphaned pending auth (snState already consumed)
      await tokenStore.deletePendingAuth(snStateData.pendingAuthId);

      // Redirect the error back to the MCP client so it gets a
      // deterministic OAuth error instead of hanging on a JSON 500.
      const redirectUrl = new URL(pendingAuth.redirectUri);
      redirectUrl.searchParams.set("error", "server_error");
      redirectUrl.searchParams.set("error_description", "Failed to exchange ServiceNow authorization code");
      if (pendingAuth.state) {
        redirectUrl.searchParams.set("state", pendingAuth.state);
      }
      res.redirect(redirectUrl.toString());
    }
  });

  return router;
}
