import { remoteKeySource } from "@ultimyr/authz";
import { buildApp } from "./app.js";
import { loadMcpConfig } from "./config.js";

const cfg = loadMcpConfig();
const app = await buildApp({ cfg, keySource: remoteKeySource(`${cfg.authUrl}/.well-known/jwks.json`), logger: cfg.nodeEnv !== "test" });

for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => void app.close().then(() => process.exit(0)));
await app.listen({ port: cfg.port, host: cfg.host });
