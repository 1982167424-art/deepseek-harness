# Agent Note: bcrypt sealing for API keys

Status: implemented

English | [中文](2026-08-15-bcrypt-credential-sealing.zh.md)

## Problem

Keys added through the harness reach providers as plaintext resolved by the [credentials seam](../../packages/credentials/credentials/README.md), and the at-rest `.credentials.yaml` document stores them verbatim. That document is `0600`, which stops other OS users — not backups, configuration UIs, or the same-UID processes the [security boundary](../../packages/credentials/credentials-local/README.md#security-boundary) already names. Sharing a dotfile or rendering a settings screen therefore meant sharing a usable secret, and a rotated or mistyped environment key only surfaced as an opaque upstream `401` after a request had already gone out.

## Decision

**Sealing pins the plaintext channel instead of replacing it.** `dsh-credentials-bcrypt` registers `ctx.bcryptCredentials`, whose `seal(ref, value)` bcrypt-hashes the key and stores only the digest under a derived pin reference (`DEEPSEEK_API_KEY` → `DEEPSEEK_API_KEY_BCRYPT`); the plaintext keeps arriving per operation through the seam's existing layers. Every check re-resolves the plaintext and compares it against the digest, so the document becomes shareable and renderable without a usable secret, and drift between the live key and the sealed one is a loud local mismatch rather than a remote authentication failure.

**Operations are per reference and explicit.** `unseal` removes the pin (absent pin: no-op), `status` reports `{ pinned, verified? }` with neither secret in it, and `assertVerified` fails loud for a missing or mismatched plaintext — the intended call before a sealed key's first upstream use. `verifyApiKey` rejects a stored value that is not a bcrypt digest (modular-crypt `$2[aby]$` prefix) at the comparison boundary, because a hand-corrupted pin can never verify and deserves a named error, not a silent mismatch.

**Update-time verification is an observer, not a gate.** With `verifyOnUpdate` (default on), a committed change to either side of a pin re-runs the comparison via `credentials/updated`; mismatches log as errors and never rethrow, because the write has already committed and a broken observer must not make it look failed. The listener is a service effect and dies with the service — stored pins survive disposal untouched.

**Configuration is validated, defaulted once, and shared.** `cost` (default `10`), `pinSuffix` (default `_BCRYPT`, `[_A-Za-z0-9]` only so a pin can never collide with the plaintext reference), and `verifyOnUpdate` resolve through one `resolveSpec` used by both the Schemastery schema and programmatic construction. `bcryptjs` (pure JavaScript) carries the hashing; the native `bcrypt` addon's node-gyp build is a deployment hazard this seam does not need.

## Alternatives considered

**Encrypt the stored key instead of hashing it.** Rejected because decryption needs a key that is itself at rest somewhere, which recreates the problem one level down; bcrypt's one-way digest plus per-operation plaintext resolution gives verification without any recoverable secret.

**Store digests in a sidecar file owned by this package.** Rejected because the credentials document is already the seam's durable store with atomic writes and hot reload; a second file doubles the failure modes and hides from `describe()`-driven UIs.

**Verify on every resolve inside the seam itself.** Rejected because that couples every credential consumer to bcrypt cost latency and makes the base seam depend on this package; sealing is opt-in per key, so verification belongs to explicit checks and update-time observation.

**Fail the write when update-time verification mismatches.** Rejected because the change is already committed when the event fires; rethrowing from a listener would misreport a successful rotation as a failed one.

## Consequences

A sealed key's document carries a 60-character digest instead of a secret, and rotation is caught the moment either side changes — at the cost of a bcrypt comparison (~tens of milliseconds at cost 10) per explicit check, and of the plaintext still having to exist somewhere for anything to verify at all. Deployments that must keep keys away from the running agent still need the deferred OS-keychain provider; sealing raises the bar for the at-rest document, it is not a process boundary. The pin-reference pattern lands as a second consumer of derived credential references, which any future keychain provider can reuse for its own anchoring. Coverage lives in the package suite: digest shape, seal/unseal/status/assertVerified behavior, suffix bounds, update-time re-verification (including disposal and the disabled flag), and the invariant companion's lifecycle guard.
