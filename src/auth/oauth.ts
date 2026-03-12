import { Router, json, type Request, type Response } from "express";
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
      res.status(500).json({
        success: false,
        error: { code: "TOKEN_EXCHANGE_FAILED", message: "Failed to exchange ServiceNow authorization code" },
      });
    }
  });

  // GET /oauth/authorize — redirect user to ServiceNow OAuth (deprecated: use SDK flow)
  router.get("/authorize", async (req: Request, res: Response) => {
    logger.warn("Deprecated /oauth/authorize endpoint called — use SDK OAuth flow instead");
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

  // GET /oauth/callback — exchange code for tokens (deprecated: use SDK flow)
  router.get("/callback", async (req: Request, res: Response) => {
    logger.warn("Deprecated /oauth/callback endpoint called — use SDK OAuth flow instead");
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

      // Look up authenticated user via server-side gs.getUserName() query
      // This resolves to the user who owns the access token
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
      const userInfo: { sys_id: string; user_name: string; name: string } = {
        sys_id: currentUser.sys_id,
        user_name: currentUser.user_name,
        name: currentUser.name || currentUser.user_name,
      };

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

  // POST /oauth/reconnect-token — generate a reconnect token (deprecated)
  router.post("/reconnect-token", json(), async (req: Request, res: Response) => {
    logger.warn("Deprecated /oauth/reconnect-token endpoint called — use SDK OAuth refresh tokens instead");
    const { user_sys_id } = req.body ?? {};

    if (!user_sys_id || typeof user_sys_id !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_REQUEST", message: "Missing user_sys_id" },
      });
      return;
    }

    // Verify user has OAuth credentials in Redis
    const existing = await tokenStore.getToken(user_sys_id);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: "NO_CREDENTIALS", message: "No OAuth credentials found for this user" },
      });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const ttl = config.RECONNECT_TOKEN_TTL;
    await tokenStore.storeReconnectToken(token, user_sys_id, ttl);

    logger.info({ userSysId: user_sys_id }, "Reconnect token generated");

    res.status(201).json({
      success: true,
      reconnect_token: token,
      ttl_seconds: ttl,
    });
  });

  // DELETE /oauth/reconnect-token — revoke reconnect token(s) (deprecated)
  router.delete("/reconnect-token", json(), async (req: Request, res: Response) => {
    logger.warn("Deprecated DELETE /oauth/reconnect-token endpoint called");
    const { user_sys_id, reconnect_token, revoke_all } = req.body ?? {};

    if (!user_sys_id || typeof user_sys_id !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_REQUEST", message: "Missing user_sys_id" },
      });
      return;
    }

    if (revoke_all) {
      await tokenStore.revokeAllReconnectTokens(user_sys_id);
      logger.info({ userSysId: user_sys_id }, "All reconnect tokens revoked");
      res.status(200).json({ success: true, message: "All reconnect tokens revoked" });
      return;
    }

    if (!reconnect_token || typeof reconnect_token !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_REQUEST", message: "Missing reconnect_token or revoke_all" },
      });
      return;
    }

    await tokenStore.revokeReconnectToken(reconnect_token, user_sys_id);
    logger.info({ userSysId: user_sys_id }, "Reconnect token revoked");
    res.status(200).json({ success: true, message: "Reconnect token revoked" });
  });

  return router;
}
