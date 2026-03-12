import crypto from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { TokenStore } from "./tokenStore.js";

const CLIENT_TTL_SECONDS = 7776000; // 90 days

export class RedisClientStore implements OAuthRegisteredClientsStore {
  constructor(private tokenStore: TokenStore) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const raw = await this.tokenStore.getOAuthClient(clientId);
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthClientInformationFull;
  }

  async registerClient(
    clientMetadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString("hex");

    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: Math.floor(Date.now() / 1000) + CLIENT_TTL_SECONDS,
    };

    await this.tokenStore.storeOAuthClient(
      clientId,
      JSON.stringify(client),
      CLIENT_TTL_SECONDS
    );

    return client;
  }
}
