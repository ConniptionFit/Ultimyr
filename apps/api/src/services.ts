/**
 * The services the api container runs. Each one stays its own package (services/<folder>) with its own routes, tables
 * and tests; this list is the only place the container learns about them. They talk to each other over HTTP on
 * loopback exactly as they did when each had a container, so nothing in a service knows it shares a container.
 */
export interface ServiceSpec {
  /** Short name used in logs and the status endpoint. */
  name: string;
  /** Folder under services/. */
  folder: string;
  /** Port the service listens on inside the container (also published by compose for headless use). */
  port: number;
  /** Start group: services in a group start together and the next group waits for it to answer /healthz. */
  group: number;
}

export const SERVICES: ServiceSpec[] = [
  { name: "auth", folder: "auth", port: 4001, group: 0 },
  { name: "content", folder: "content", port: 4002, group: 1 },
  { name: "quiz", folder: "quiz", port: 4003, group: 2 },
  { name: "ai", folder: "ai-gateway", port: 4004, group: 3 },
  { name: "notes", folder: "notes", port: 4006, group: 3 },
  { name: "mcp", folder: "mcp", port: 4005, group: 3 },
];

/** Where the services call each other. Always loopback: the services share this container. */
export function internalUrls(): Record<string, string> {
  const url = (name: string) => `http://127.0.0.1:${SERVICES.find((s) => s.name === name)!.port}`;
  return {
    AUTH_URL: url("auth"),
    CONTENT_URL: url("content"),
    QUIZ_URL: url("quiz"),
    AI_URL: url("ai"),
    MCP_URL: url("mcp"),
    NOTES_URL: url("notes"),
  };
}

/** The environment one service gets: the container's own, the loopback addresses, and its port. */
export function serviceEnv(spec: ServiceSpec, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    ...internalUrls(),
    PORT: String(spec.port),
    HOST: "0.0.0.0",
    // The api container applies every service's migrations once before any service starts.
    NOTES_AUTO_MIGRATE: "false",
  };
}
