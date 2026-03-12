import crypto from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthTokens,
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidTokenError, InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Config } from "../config.js";
import { TokenStore } from "./tokenStore.js";
import { RedisClientStore } from "./clientStore.js";
import { logger } from "../utils/logger.js";

const PENDING_AUTH_TTL = 600; // 10 min
const SN_STATE_TTL = 600; // 10 min
const MCP_ACCESS_TOKEN_TTL = 3600; // 1 hour
const MCP_REFRESH_TOKEN_TTL = 2592000; // 30 days

export class ServiceNowOAuthProvider implements OAuthServerProvider {
  private _clientsStore: RedisClientStore;

  constructor(
    private config: Config,
    private tokenStore: TokenStore,
  ) {
    this._clientsStore = new RedisClientStore(tokenStore);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    _client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // Generate a pending auth ID to link the SN callback back to this authorization
    const pendingAuthId = crypto.randomBytes(16).toString("hex");

    await this.tokenStore.storePendingAuth(pendingAuthId, {
      clientId: _client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
    }, PENDING_AUTH_TTL);

    // Generate CSRF state for ServiceNow leg
    const snState = crypto.randomBytes(32).toString("hex");
    await this.tokenStore.storeSnState(snState, { pendingAuthId }, SN_STATE_TTL);

    // Redirect to ServiceNow OAuth
    const snParams = new URLSearchParams({
      response_type: "code",
      client_id: this.config.SERVICENOW_CLIENT_ID,
      redirect_uri: this.config.SN_CALLBACK_URI,
      state: snState,
    });

    const authorizeUrl = `${this.config.SERVICENOW_INSTANCE_URL}/oauth_auth.do?${snParams.toString()}`;
    logger.info("Redirecting to ServiceNow OAuth (SDK flow)");
    res.redirect(authorizeUrl);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const data = await this.tokenStore.getAuthCode(authorizationCode);
    if (!data) {
      throw new InvalidGrantError("Authorization code not found or expired");
    }
    return data.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    // Atomically consume the authorization code (one-time use)
    const codeData = await this.tokenStore.consumeAuthCode(authorizationCode);
    if (!codeData) {
      throw new InvalidGrantError("Authorization code not found or expired");
    }

    // Verify the code was issued to this client (RFC 6749 §4.1.3)
    if (codeData.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code was not issued to this client");
    }

    // Verify redirect_uri matches if provided (RFC 6749 §4.1.3)
    if (redirectUri && codeData.redirectUri !== redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }

    const { userSysId, clientId, scopes } = codeData;

    // Generate opaque MCP tokens
    const accessToken = crypto.randomBytes(32).toString("hex");
    const refreshToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + MCP_ACCESS_TOKEN_TTL;

    await this.tokenStore.storeMcpToken(accessToken, {
      userSysId,
      clientId,
      scopes,
      expiresAt,
    }, MCP_ACCESS_TOKEN_TTL);

    await this.tokenStore.storeMcpRefreshToken(refreshToken, {
      userSysId,
      clientId,
      scopes,
    }, MCP_REFRESH_TOKEN_TTL);

    logger.info({ userSysId }, "MCP access token issued");

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const refreshData = await this.tokenStore.getMcpRefreshToken(refreshToken);
    if (!refreshData) {
      throw new InvalidGrantError("Refresh token not found or expired");
    }

    // Verify the refresh token was issued to this client
    if (refreshData.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token was not issued to this client");
    }

    // Verify user still has valid SN credentials
    const snToken = await this.tokenStore.getToken(refreshData.userSysId);
    if (!snToken) {
      // SN credentials gone — revoke our refresh token too
      await this.tokenStore.deleteMcpRefreshToken(refreshToken);
      throw new InvalidGrantError("ServiceNow credentials expired. Re-authentication required.");
    }

    // Generate new access token
    const newAccessToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + MCP_ACCESS_TOKEN_TTL;
    const effectiveScopes = scopes ?? refreshData.scopes;

    await this.tokenStore.storeMcpToken(newAccessToken, {
      userSysId: refreshData.userSysId,
      clientId: refreshData.clientId,
      scopes: effectiveScopes,
      expiresAt,
    }, MCP_ACCESS_TOKEN_TTL);

    logger.info({ userSysId: refreshData.userSysId }, "MCP access token refreshed");

    return {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = await this.tokenStore.getMcpToken(token);
    if (!data) {
      throw new InvalidTokenError("Access token not found or expired");
    }

    const now = Math.floor(Date.now() / 1000);
    if (data.expiresAt <= now) {
      await this.tokenStore.deleteMcpToken(token);
      throw new InvalidTokenError("Access token expired");
    }

    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: data.expiresAt,
      extra: { userSysId: data.userSysId },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const { token, token_type_hint } = request;

    if (token_type_hint === "refresh_token") {
      const data = await this.tokenStore.getMcpRefreshToken(token);
      if (data && data.clientId !== client.client_id) {
        throw new InvalidGrantError("Token was not issued to this client");
      }
      await this.tokenStore.deleteMcpRefreshToken(token);
    } else if (token_type_hint === "access_token") {
      const data = await this.tokenStore.getMcpToken(token);
      if (data && data.clientId !== client.client_id) {
        throw new InvalidGrantError("Token was not issued to this client");
      }
      await this.tokenStore.deleteMcpToken(token);
    } else {
      // No hint — check both types, verify ownership if found
      const accessData = await this.tokenStore.getMcpToken(token);
      if (accessData && accessData.clientId !== client.client_id) {
        throw new InvalidGrantError("Token was not issued to this client");
      }
      const refreshData = await this.tokenStore.getMcpRefreshToken(token);
      if (refreshData && refreshData.clientId !== client.client_id) {
        throw new InvalidGrantError("Token was not issued to this client");
      }
      await this.tokenStore.deleteMcpToken(token);
      await this.tokenStore.deleteMcpRefreshToken(token);
    }

    logger.info("Token revoked");
  }
}
