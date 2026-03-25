import * as fs from "fs";
import * as path from "path";

export const STORE_ROOT = path.resolve(__dirname, "../../store");
export const LOGS_DIR = path.join(STORE_ROOT, "logs");
export const CAMPERS_DIR = path.join(STORE_ROOT, "campers");
export const PLANS_DIR = path.join(STORE_ROOT, "plans"); // ← NEW

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Camper store (existing) ──────────────────────────────────────────────────

function buildCamperPath(session_id: string, namespace: string): string {
  const safe = `${session_id}___${namespace}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(CAMPERS_DIR, `${safe}.json`);
}

export function camperWrite(
  session_id: string,
  namespace: string,
  data: unknown,
): void {
  ensureDir(CAMPERS_DIR);
  fs.writeFileSync(
    buildCamperPath(session_id, namespace),
    JSON.stringify(data),
    "utf8",
  );
}

export function camperRead(
  session_id: string,
  namespace: string,
): unknown | null {
  const filePath = buildCamperPath(session_id, namespace);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// ─── Plan store (NEW) ─────────────────────────────────────────────────────────

export function planWrite(session_id: string, data: unknown): void {
  ensureDir(PLANS_DIR);
  const safe = session_id.replace(/[^a-zA-Z0-9_\-]/g, "_");
  fs.writeFileSync(
    path.join(PLANS_DIR, `${safe}.json`),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

export function planRead(session_id: string): any | null {
  const safe = session_id.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const filePath = path.join(PLANS_DIR, `${safe}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
