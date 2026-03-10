import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encrypt, decrypt, getEncryptionKey } from "../../../src/auth/encryption.js";

const TEST_KEY = crypto.randomBytes(32).toString("base64");
const key = getEncryptionKey(TEST_KEY);

describe("encryption", () => {
  it("should round-trip encrypt and decrypt", () => {
    const plaintext = JSON.stringify({
      access_token: "test_access",
      refresh_token: "test_refresh",
      expires_at: 1234567890,
    });

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same data";
    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);

    expect(enc1).not.toBe(enc2);
  });

  it("should detect tampering", () => {
    const encrypted = encrypt("secret", key);
    const tampered =
      encrypted.slice(0, -2) +
      (encrypted.slice(-1) === "A" ? "B" : "A") +
      encrypted.slice(-1);

    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("should fail with wrong key", () => {
    const wrongKey = getEncryptionKey(
      crypto.randomBytes(32).toString("base64")
    );
    const encrypted = encrypt("secret", key);

    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("should reject keys that are not 32 bytes", () => {
    expect(() => getEncryptionKey(Buffer.from("short").toString("base64"))).toThrow(
      "must decode to 32 bytes"
    );
  });
});
