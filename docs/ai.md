# AI gateway

Bring your own AI key (Gemini, OpenAI or Anthropic) and Ultimyr can write draft guides, decks and quiz questions, and answer questions about what you are studying. The gateway is the only place that ever sees a key.

## What it does
- **Generate** a study guide, flashcard deck or set of quiz questions from a topic, optionally grounded in source material you paste. The result is saved as a **draft** (`source: ai`) in the archive. Only editors see it until someone reviews and publishes it. Nothing AI writes is published automatically.
- **Assistant** chat tied to the page you are on: a guide, a deck, or the results of an attempt ("Explain my mistakes"). Answers stream in.
- **Test** a saved key with one tiny request.

## Connect a key
Settings, **AI connections**: pick a provider, name the key, paste it. After saving, only the label and the last four characters are ever shown. Set a default key and, if you like, a model per provider.

**Gemini sign-in is not built.** "Sign in with Google to use Gemini" (OAuth) is not implemented, so Gemini uses an API key like the others. Model names are configurable (the defaults change as providers retire models): `AI_DEFAULT_MODEL_GEMINI`, `AI_DEFAULT_MODEL_OPENAI`, `AI_DEFAULT_MODEL_ANTHROPIC`, or per person in Settings.

## How keys are protected
- **Envelope encryption (AES-256-GCM).** A master key (KEK, from `ULTIMYR_VAULT_KEK` or the `vault_kek` Docker secret) wraps one random data key per person. That data key encrypts each of their credentials. Each ciphertext is bound to its owner, id, provider and key version, so a copied row will not decrypt for anyone else.
- **Write-only.** No endpoint returns a key. Identity comes only from the access token, and no route accepts a user id.
- **No plaintext fallback.** Without a KEK the vault is disabled and AI routes answer 503 `vault_unavailable`.
- **Keys travel in headers**, never URLs, are held in memory only for the length of one request, and are never logged. Provider errors are mapped to safe codes (`credential_rejected`, `rate_limited`, `provider_unavailable`, `provider_error`, `bad_response`), never the provider's body.
- **Providers are an operator allowlist.** Base URLs are fixed by configuration and must be https (`AI_ALLOW_INSECURE_PROVIDER=true` is for local testing only), so a request can never be pointed at an internal address.
- **Prompt injection.** Source text goes inside `<source>` tags, the closing tag is stripped from it, and the instructions say to treat it as data. Model output is validated (quiz questions must pass the same checks as hand written ones; invalid ones are dropped and counted) and lands as a draft, written with **your own** token, so it can only go where you could already write.
- **Limits.** `AI_DAILY_REQUESTS` per person per day (default 200), `AI_MAX_OUTPUT_TOKENS`, three generations at a time, rate limits on write routes.

## Operating it
| Task | How |
|---|---|
| First setup | `./scripts/init-secrets.sh` creates `secrets/vault_kek`. **Back it up with the rest of `secrets/`.** Without it, stored keys cannot be read and people must add them again. |
| Rotate the master key | Generate a new key. Set `ULTIMYR_VAULT_KEK` to it and `ULTIMYR_VAULT_KEK_VERSION` to the next number, and set `ULTIMYR_VAULT_KEK_PREVIOUS="1:<old base64>"`. Restart. Then call `POST /api/v1/ai/admin/rewrap-keys` as a platform admin. It re-wraps the data keys only (credentials are not touched). Once it returns `{ "rewrapped": 0 }` on a second call, drop `..._PREVIOUS`. |
| Remove everything a person stored | `DELETE /api/v1/ai/me` (their own data). It deletes their data key, which makes every stored ciphertext permanently unreadable ("crypto-shredding"), and removes their credentials, preferences, jobs, usage and conversations. |
| Deprovisioned by SCIM | SCIM deactivation does not call the purge yet. An admin or the user must call `DELETE /v1/ai/me`. Automating this is planned for Phase 9. |

## API
All under `/api/v1/ai`, scope `ai:use`.

| Method | Path | Notes |
|---|---|---|
| GET | `/status` | `vault` on or off, providers, default models, today's usage and limit. |
| GET, POST | `/credentials` | POST `{ provider, label, secret }`. Returns id, provider, label, `last4`. |
| DELETE | `/credentials/:id` | Erases it. |
| POST | `/credentials/:id/test` | `{ ok, provider, model, error? }`. |
| GET, PUT | `/preferences` | `{ defaultCredentialId, models: { gemini?, openai?, anthropic? } }`. |
| POST | `/generate` | `{ kind: guide|deck|quiz, archiveId, topic, source?, instructions?, count?, title?, credentialId? }`. 202 `{ jobId }`. You need edit access to the archive. |
| GET | `/jobs`, `/jobs/:id` | `queued`, `running`, `succeeded` (with `result.itemId`), `failed` (with a safe `error`) or `interrupted` (server restarted). |
| GET, POST | `/agent/threads` | POST `{ title?, context?: { type: item|attempt, id } }`. |
| GET, DELETE | `/agent/threads/:id` | Thread with messages. |
| POST | `/agent/threads/:id/messages` | `{ content, credentialId? }`. Server-sent events: `delta` `{ text }`, then `done` `{ messageId, tokensIn, tokensOut }`, or `error` `{ code }`. |
| DELETE | `/me` | Crypto-shred everything of yours. |
| POST | `/admin/rewrap-keys` | Platform admin only. |

Job rows and messages never contain keys. A generation job stores only the length of your source text, not the text.

## Troubleshooting
| Symptom | Fix |
|---|---|
| 503 `vault_unavailable` | No master key. Run `scripts/init-secrets.sh` and check the `vault_kek` secret mount. |
| 409 `credential_unrecoverable` | The key was sealed with a master key this server no longer has. Delete it and add it again. |
| `credential_rejected` | The provider refused the key. Test it in Settings. |
| `model_output_invalid` | The model did not return usable JSON. Try again, with a smaller request or more source detail. |
