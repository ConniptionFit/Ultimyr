# ADR 0008: AI gateway and key vault

**Status:** Accepted (Phase 6)

## Decisions
- **Bring your own key, held in a vault inside the gateway.** The platform has no AI account of its own. Each person adds a key for Gemini, OpenAI or Anthropic. Only the `ai-gateway` service reads them.
- **Envelope encryption with a per-user data key.** A KEK from a Docker secret wraps each person's data key (AES-256-GCM, versioned). Per-user keys make crypto-shredding a single row delete, and KEK rotation re-wraps data keys without touching credentials. Associated data binds every ciphertext to its owner and context.
- **Fail closed.** No KEK means no vault and 503, never plaintext storage.
- **Write-only credentials.** Nothing returns a key, and identity is only ever the token.
- **Operator allowlist of provider base URLs** instead of user-supplied endpoints, to rule out request forgery against internal services.
- **Direct HTTP adapters, not vendor SDKs.** Three small streaming adapters keep dependencies minimal and make errors uniform and safe. Model names are configuration because providers retire them often.
- **AI output is always a draft**, written to the content and quiz services with the caller's own token (so existing access rules apply with no special AI privilege), and marked `source: ai`.
- **Jobs are an in-process queue** with rows for status, not a separate worker service. Generation takes seconds to a minute and is bounded per person. A restart marks running jobs `interrupted` so the UI can say so.
- **Google OAuth for Gemini is not built.** Whether consumer Gemini access can be granted by OAuth to a third party is unconfirmed, so the user key path is what exists.

## Consequences
Losing the KEK loses every stored key (people re-add them), so it is backed up with the other secrets. SCIM deprovisioning does not yet purge a person's AI data automatically (Phase 9). Usage counts are best effort and per person.
