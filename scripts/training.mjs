// Training site (T-24): the same app with its own Supabase project ("Outdoor Training"), a "Training site"
// banner, its own build folder (.next-training) and port 3001 — so it runs next to `npm run dev` (port 3000).
//
//   npm run training:build   build the training copy (run again after every code update)
//   npm run training:start   start it on http://localhost:3001 (and your network address, for trainees)
//
// Settings come from .env.training.local (ignored by Git; fill it in yourself — never in chat or code).
// Values there win over .env.local; anything missing (e.g. the Telesom lines) falls back to .env.local.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.training.local");
const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
export const TRAINING_PORT = 3001;

/** KEY=value lines → object (comments and blank lines ignored; surrounding quotes removed). */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function trainingEnv() {
  if (!existsSync(envFile)) {
    fail("Create .env.training.local first (see docs/06-operations/training-site.md, step 2).");
  }
  const values = parseEnv(readFileSync(envFile, "utf8"));
  const missing = REQUIRED.filter((key) => !values[key]);
  if (missing.length) fail(`Fill in these lines in .env.training.local: ${missing.join(", ")}`);
  const staging = existsSync(path.join(root, ".env.local")) ? parseEnv(readFileSync(path.join(root, ".env.local"), "utf8")) : {};
  if (staging.NEXT_PUBLIC_SUPABASE_URL && staging.NEXT_PUBLIC_SUPABASE_URL === values.NEXT_PUBLIC_SUPABASE_URL) {
    fail("The training site must use its own Supabase project, not the staging one. Check NEXT_PUBLIC_SUPABASE_URL.");
  }
  // Names only — never print the values.
  console.log(`Training settings loaded: ${Object.keys(values).sort().join(", ")}`);
  return { ...process.env, ...values, NEXT_PUBLIC_APP_ENVIRONMENT: "training", NEXT_DIST_DIR: ".next-training" };
}

function run(args, env) {
  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

const command = process.argv[2];
// Run only when executed directly (tests import parseEnv).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command === "build") run(["build"], trainingEnv());
  else if (command === "start") {
    const env = trainingEnv();
    if (!existsSync(path.join(root, ".next-training", "BUILD_ID"))) fail("Build it first: npm run training:build");
    console.log(`\nTraining site: http://localhost:${TRAINING_PORT}  (trainees on the same Wi-Fi: http://<this computer's address>:${TRAINING_PORT})\n`);
    run(["start", "-p", String(TRAINING_PORT), "-H", "0.0.0.0"], env);
  } else fail("Use: npm run training:build  or  npm run training:start");
}
