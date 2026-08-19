import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, "..");
const projectDir = resolve(backendDir, "..");
const lanMode = process.argv.includes("--lan");
const hostname = lanMode ? "0.0.0.0" : "127.0.0.1";
const port = process.env.PI_WEB_BACKEND_PORT?.trim() || "30142";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("PI_WEB_BACKEND_PORT must be a valid TCP port");
}
const piAgentDir = process.env.PI_CODING_AGENT_DIR || resolve(projectDir, "runtime/pi-agent");
const userDataRoot = process.env.PI_WEB_USER_DATA_ROOT || resolve(projectDir, "runtime/user-data");

mkdirSync(piAgentDir, { recursive: true });
mkdirSync(userDataRoot, { recursive: true });

const localFrontendOrigins = [
  "http://localhost:30141",
  "http://127.0.0.1:30141",
  "http://0.0.0.0:30141",
];

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: piAgentDir,
  PI_WEB_USER_DATA_ROOT: userDataRoot,
  PI_WEB_FIXED_USER_ID: process.env.PI_WEB_FIXED_USER_ID || "user1",
  PI_WEB_CORS_ORIGINS: process.env.PI_WEB_CORS_ORIGINS || localFrontendOrigins.join(","),
};

console.log("Pi Web backend local development settings:");
console.log(`  URL: http://${hostname}:${port} (health: /api/health)`);
console.log(`  managed user data: ${userDataRoot}`);
console.log(`  agent config: ${piAgentDir}`);
console.log("  security: direct local dev inherits your macOS user file permissions; use Docker for isolation");
if (lanMode && !process.env.PI_WEB_CORS_ORIGINS) {
  console.log("  LAN note: set PI_WEB_CORS_ORIGINS to the frontend's actual http://IP:30141 origin");
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "-H", hostname, "-p", port], {
  cwd: backendDir,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 0 : 1));
});
