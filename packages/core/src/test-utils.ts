import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";

export interface Keypair {
  secretKeyHex: string;
  publicKeyHex: string;
}

/**
 * Generates a fresh random Ed25519 keypair for use in tests.
 * Exported from a single location so sign.test.ts and quorum.test.ts
 * don't duplicate the implementation.
 */
export function freshKeypair(): Keypair {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(secretKey);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}
