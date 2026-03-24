import * as fs from "fs";
import * as path from "path";

export const STORE_ROOT = path.resolve(__dirname, "../../store");
export const LOGS_DIR = path.join(STORE_ROOT, "logs");
export const CAMPERS_DIR = path.join(STORE_ROOT, "campers");

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

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
