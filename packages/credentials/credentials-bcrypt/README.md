# dsh-credentials-bcrypt

English | [中文](README.zh.md)

bcrypt sealing for API keys added to the harness: the credentials document stores only a digest, and every check re-resolves the live plaintext through the [credentials](../credentials/README.md) seam.

bcrypt is a one-way hash, so sealing does not replace the plaintext channel — it pins it. `seal` hashes a key and stores the digest under a derived reference (`DEEPSEEK_API_KEY` → `DEEPSEEK_API_KEY_BCRYPT`); the plaintext keeps arriving per operation through the seam's own layers (inherited environment, `.credentials.yaml`, `.env`). The at-rest document may then be shared, backed up, or shown in a configuration UI without exposing a usable secret, and a rotated or mistyped environment key surfaces as a loud mismatch instead of an opaque upstream `401`.

## Surface

| Member | Meaning |
|---|---|
| `seal(ref, value)` | Hash `value` and store the digest under the pin reference. |
| `unseal(ref)` | Remove the pin; removing an absent pin is a no-op. |
| `status(ref)` | `{ pinned, verified? }` — safe for configuration UIs, never carries the digest or plaintext. |
| `assertVerified(ref)` | Fail loud when a pinned reference's plaintext is missing or mismatches. |
| `pinnedDigest(ref)` | The stored digest, or `undefined` while unpinned. |
| `hashApiKey` / `verifyApiKey` | Digest primitives; `verifyApiKey` rejects a non-bcrypt digest instead of comparing. |

## Config

| Field | Default | Meaning |
|---|---|---|
| `cost` | `10` | bcrypt cost factor; higher costs slow every seal and check. |
| `pinSuffix` | `_BCRYPT` | Suffix deriving the pin reference; `[_A-Za-z0-9]` only, so a pin can never collide with the plaintext reference. |
| `verifyOnUpdate` | `true` | Re-verify a committed change to a pinned reference's plaintext or digest. |

## Update-time verification

With `verifyOnUpdate` on, a committed change to either side of a pin re-runs the comparison: a plaintext change re-checks its own pin, a digest change re-checks the base reference. The write has already committed, so a mismatch is logged as an error rather than rethrown — a broken observer must not make a successful write look failed. The listener lives with the service; disposal stops re-verification without touching stored pins.

## Model Experience

Indirectly, through the consuming LLM adapters: a verified value authorizes their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; digests and plaintexts never enter a request prefix.

## Known Limitations and Deferred Work

- **The plaintext still has to exist somewhere** — bcrypt verifies, it does not substitute; a deployment that must keep keys away from the running agent needs an OS-keychain provider, which stays the deferred answer beside [`dsh-credentials-local`](../credentials-local/README.md).
- **No seal-all entry point** — sealing is per reference and explicit; a UI that wants to pin every stored key enumerates and seals them itself.
- **Cost is global, not per key** — one configured cost covers every seal; per-reference costs have no consumer.
- **Verification is check-time, not continuous** — between updates, a drifting plaintext is caught by `assertVerified` or `status`, both caller-invoked.
