// Create a sign-in account (Phase 3 bootstrap; Phase 4 adds the Users screen). Run on YOUR computer:
//
//   npm run user:create -- --type permanent --email you@sogasho.com --name "Your Name"
//   npm run user:create -- --type temporary --phone 0634123456 --name "Test Agent"
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (never commit them).
// Prints a one-time temporary password in YOUR terminal only. The user must change it at first sign-in.
// Never paste the printed password into chat.
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// Keep in sync with src/lib/phone.ts and src/lib/auth/identity.ts (tests/unit/auth.test.ts checks this).
export const AGENT_EMAIL_DOMAIN = "phone.outdoor.sogasho.com";

export function normalizePhone(input) {
  const digits = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  let national;
  if (digits.startsWith("+252")) national = digits.slice(4);
  else if (digits.startsWith("+")) return null;
  else if (digits.startsWith("00252")) national = digits.slice(5);
  else if (digits.startsWith("252") && digits.length > 9) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  if (!/^[1-9]\d{6,8}$/.test(national)) return null;
  return `+252${national}`;
}

export function agentAuthEmail(phoneE164) {
  return `agent.${phoneE164.replace(/^\+/, "")}@${AGENT_EMAIL_DOMAIN}`;
}

export function temporaryPassword() {
  // 12 characters from an unambiguous alphabet, always with letters and digits.
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function main() {
  const { values } = parseArgs({
    options: {
      type: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      name: { type: "string" },
    },
  });

  const fail = (msg) => {
    console.error(`\n✖ ${msg}\n`);
    process.exit(1);
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) fail("Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local first.");
  if (!values.name || values.name.trim().length < 2) fail('Give the full name: --name "First Last"');

  let email;
  const metadata = { full_name: values.name.trim(), employment_type: values.type };
  if (values.type === "permanent") {
    email = values.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Permanent users need a valid --email");
  } else if (values.type === "temporary") {
    const phone = values.phone ? normalizePhone(values.phone) : null;
    if (!phone) fail("Temporary agents need a valid Somaliland --phone, e.g. 0634123456");
    email = agentAuthEmail(phone);
    metadata.phone_e164 = phone;
  } else {
    fail("Use --type permanent or --type temporary");
  }

  const password = temporaryPassword();
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) fail(`Supabase refused: ${error.message}`);

  console.log("\n✔ Account created");
  console.log(`  Name:      ${metadata.full_name}`);
  console.log(`  Type:      ${values.type}`);
  console.log(`  Sign in:   ${values.type === "temporary" ? metadata.phone_e164 : email}`);
  console.log(`  Password:  ${password}   (temporary — must be changed at first sign-in)`);
  console.log(`  User id:   ${data.user.id}\n`);
  console.log("Give the password to the person privately. Do not paste it into chat or documents.\n");
}

if (process.argv[1] && process.argv[1].endsWith("create-user.mjs")) await main();
