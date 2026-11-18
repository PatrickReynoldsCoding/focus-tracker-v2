declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
    ASSETS: Fetcher;
    OWNER_PASSWORD: string;
    SESSION_SECRET: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
