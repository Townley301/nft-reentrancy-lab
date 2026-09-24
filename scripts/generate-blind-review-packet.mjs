#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBlindReviewPacket } from "./lib/report-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = path.join(ROOT, "evaluation", "blind-review-plan.json");
const STATIC = path.join(ROOT, "analysis", "shared-state-report.json");
const OUTPUT = path.join(ROOT, "analysis", "blind-review-packet.json");

if (!fs.existsSync(STATIC)) throw new Error("Missing analysis/shared-state-report.json; run pnpm audit:coverage first.");
const packet = buildBlindReviewPacket(
  JSON.parse(fs.readFileSync(PLAN, "utf8")),
  JSON.parse(fs.readFileSync(STATIC, "utf8")),
);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`Generated label-free local review packet with ${packet.cases.length} cases: analysis/blind-review-packet.json`);
console.log("Review status remains pending; no independent result has been claimed.");
