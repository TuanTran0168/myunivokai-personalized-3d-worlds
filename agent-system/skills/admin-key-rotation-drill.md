# Admin access-token key-rotation drill

S4-AUTH-005 task: "Run and document a key-rotation drill with two active
public keys." Performed against the local Docker stack on 2026-08-06;
results below are what was actually observed, not a hypothetical.

## Why this works with zero forced logouts

- `services/api-gateway/internal/admin/auth.TokenVerifier` holds a **list**
  of accepted Ed25519 public keys (`ADMIN_ACCESS_PUBLIC_KEYS`, comma-separated)
  and accepts a token signed by any of them.
- `auth-service` signs with exactly one private key
  (`AUTH_ACCESS_PRIVATE_KEY`) at a time.
- The two are rotated in three separate steps, never at once, so there is
  always a window where both the outgoing and incoming key verify.

## Runbook

1. **Generate a new Ed25519 key pair.** Never reuse a seed.
   ```go
   pub, priv, _ := ed25519.GenerateKey(rand.Reader)
   fmt.Println(base64.StdEncoding.EncodeToString(priv.Seed())) // new AUTH_ACCESS_PRIVATE_KEY
   fmt.Println(base64.StdEncoding.EncodeToString(pub))         // new public key to add
   ```
2. **Add the new public key to the gateway, keep the old one.**
   `ADMIN_ACCESS_PUBLIC_KEYS=<new>,<old>` on `myunivokai-gateway`, redeploy
   the gateway only. Existing sessions (signed with the old key) are
   unaffected — the gateway now trusts both.
3. **Point auth-service at the new private key.**
   `AUTH_ACCESS_PRIVATE_KEY=<new seed>` on `myunivokai-auth`, redeploy
   auth-service only. New logins/refreshes now sign with the new key;
   already-issued old-key tokens still verify at the gateway from step 2.
4. **Wait out the access-token TTL** (`AUTH_ACCESS_TOKEN_TTL`, 10 minutes)
   so every live session has refreshed at least once and is now on a
   new-key token. In practice: wait at least one full refresh cycle plus
   a safety margin, not exactly 10 minutes.
5. **Remove the old public key from the gateway.**
   `ADMIN_ACCESS_PUBLIC_KEYS=<new>` only, redeploy the gateway. Old-key
   tokens (there should be none live) now fail verification.

## What was actually observed (local drill, 2026-08-06)

Old key pair: seed `DqpJxFDKPBAtKTcKpCXuSq7LJj0bDD/eILTTuIM8c0E=`, public
`LevwVSKfMJY075I8dtGksiMif1pouqn7aisvsZPiARI=` (the repo's throwaway local
dev key). New key pair generated fresh for this drill.

| Step | Action | Old-key token | New-key token |
|---|---|---|---|
| 0 | Baseline (only old key trusted) | 200 | n/a |
| 1 | Gateway now trusts `[new, old]`, auth-service still signs with old | 200 (unaffected) | n/a |
| 2 | auth-service switched to sign with new key | **200** (still verifies — gateway still trusts old) | **200** (a fresh login already verifies) |
| 3 | Gateway now trusts `[new]` only (old removed) | **401** (`UNAUTHENTICATED`) | **200** (unaffected) |

Step 2 is the key result: for the entire window between "auth-service
starts signing with the new key" and "the gateway drops the old key,"
**both** an old, already-issued session and a brand-new login work
correctly — nothing was force-logged-out mid-rotation. Only after the old
key is deliberately removed in step 3 does an old-key token stop verifying,
and by then production would have waited out the access-token TTL, so no
live session should have still been on the old key.

The local environment was reverted to the original single key pair
immediately after the drill; this file is what to follow for a real
rotation (production or otherwise).
