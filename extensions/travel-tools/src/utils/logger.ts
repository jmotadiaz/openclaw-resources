import { LOGS_DIR, ensureDir } from "./store";

// Inicialización lazy — el directorio se crea la primera vez que se necesita
let _logsDirReady = false;

function ensureLogsDir(): void {
  if (!_logsDirReady) {
    try {
      ensureDir(LOGS_DIR);
      _logsDirReady = true;
    } catch (e: any) {
      console.error(`[logger] Could not create logs dir: ${e.message}`);
    }
  }
}

// Exportar logsDir para que cualquier estrategia pueda escribir archivos de log
// sin conocer la ruta interna del store
export function getLogsDir(): string {
  ensureLogsDir();
  return LOGS_DIR;
}

export const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) =>
    console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) =>
    console.debug(`[DEBUG] ${msg}`, ...args),
};
