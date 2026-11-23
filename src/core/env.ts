import { existsSync } from "node:fs";

/**
 * Load .env once at process start. Existing environment variables win, so a
 * shell export or CI secret is never overwritten by a local file.
 */
const loader = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;
if (loader && existsSync(".env")) {
  try {
    loader.call(process, ".env");
  } catch {
    // A malformed .env must not take down the CLI or UI.
  }
}
