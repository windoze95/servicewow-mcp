import { TokenStore, type StoredToken } from "../auth/tokenStore.js";
import { logger } from "../utils/logger.js";

export async function resolveUserForSession(
  sessionId: string,
  tokenStore: TokenStore
): Promise<StoredToken | null> {
  const userSysId = await tokenStore.getUserForSession(sessionId);
  if (!userSysId) {
    logger.debug({ sessionId }, "No user mapping found for session");
    return null;
  }

  const token = await tokenStore.getToken(userSysId);
  if (!token) {
    logger.debug({ sessionId, userSysId }, "No token found for user");
    return null;
  }

  return token;
}
