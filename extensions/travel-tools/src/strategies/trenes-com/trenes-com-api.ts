import * as https from "https";
import { logger } from "../../utils/logger";

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING — station resolution & monthly price scouting
// ═══════════════════════════════════════════════════════════════════════════════

export interface StationResult {
  id: string; // numeric string, e.g. "10865"
  name: string; // e.g. "Madrid Atocha"
}

export interface DayPrice {
  date: string; // "YYYY-MM-DD"
  price: number;
}

/**
 * Resolves a city name to a numeric station ID using trenes.com API.
 */
export async function resolveStation(cityName: string): Promise<StationResult> {
  const body = `key=${encodeURIComponent(cityName)}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.trenes.com",
        path: "/webVersions/v21/apis/getEstaciones.php",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (compatible; travel-tools/0.1)",
          Referer: "https://www.trenes.com/",
          Origin: "https://www.trenes.com",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`getEstaciones HTTP error: ${res.statusCode}`));
            return;
          }

          logger.info(
            `[TrenesCom] resolveStation raw response for '${cityName}': ${data}`,
          );

          try {
            const response = JSON.parse(data);
            if (response.result !== "ok") {
              reject(new Error("getEstaciones failed: " + data));
              return;
            }

            const stationsObj = response.stations;
            if (!stationsObj || Object.keys(stationsObj).length === 0) {
              reject(new Error("station_not_found: " + cityName));
              return;
            }

            const groups = Object.values(stationsObj) as any[];

            for (const group of groups) {
              if (!group.estaciones) continue;

              if (group.todas) {
                for (const [key, val] of Object.entries(group.todas)) {
                  if (val === "1" && group.estaciones[key]) {
                    resolve({ id: group.estaciones[key], name: group.ciudad });
                    return;
                  }
                }
              }

              const firstStationId = Object.values(
                group.estaciones,
              )[0] as string;
              if (firstStationId) {
                resolve({ id: firstStationId, name: group.ciudad });
                return;
              }
            }

            reject(new Error("station_not_found: " + cityName));
          } catch (e: any) {
            reject(
              new Error(
                "api_auth_required: response is not JSON — cookies may be needed",
              ),
            );
          }
        });
      },
    );

    req.on("error", (e) =>
      reject(new Error("getEstaciones network error: " + e.message)),
    );
    req.write(body);
    req.end();
  });
}

/**
 * Fetches monthly prices for a route via trenes.com API.
 */
export async function fetchMonthlyPrices(
  origen: string,
  destino: string,
  mes: number,
  ano: number,
): Promise<DayPrice[]> {
  const urlParams = `?mes=${mes}&origen=${origen}&destino=${destino}&trayecto=I&ano=${ano}`;
  const path = `/webVersions/v21/apis/getPreciosDia.php${urlParams}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.trenes.com",
        path,
        method: "POST",
        headers: {
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (compatible; travel-tools/0.1)",
          Referer: "https://www.trenes.com/",
          Origin: "https://www.trenes.com",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`getPreciosDia HTTP error: ${res.statusCode}`));
            return;
          }

          logger.info(`[TrenesCom] fetchMonthlyPrices raw response: ${data}`);

          try {
            const response = JSON.parse(data);

            if (Object.keys(response).length === 0) {
              resolve([]);
              return;
            }

            if (response.result !== undefined) {
              reject(new Error("getPreciosDia unexpected format: " + data));
              return;
            }

            const prices: DayPrice[] = [];
            for (const [key, value] of Object.entries(response)) {
              if (key.length === 8) {
                const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
                const price = parseFloat(value as string);
                if (!isNaN(price)) {
                  prices.push({ date, price });
                }
              }
            }

            prices.sort((a, b) => a.date.localeCompare(b.date));
            resolve(prices);
          } catch (e: any) {
            reject(new Error("getPreciosDia JSON parse error: " + e.message));
          }
        });
      },
    );

    req.on("error", (e) =>
      reject(new Error("getPreciosDia network error: " + e.message)),
    );
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW — train results scraping via vResults.php API
// ═══════════════════════════════════════════════════════════════════════════════

export interface Passenger {
  age: number;
  infant?: number; // 0 default
  group?: number; // 0 default
  card?: number; // 0 default
}

export interface ApiSession {
  sessiondb: string;
  cookies: string;
}

export interface FetchTrainResultsParams {
  origin_id: string;
  destination_id: string;
  out_date: string; // YYYY-MM-DD
  ret_date: string | null; // YYYY-MM-DD or null for one-way
  passengers: Passenger[];
  api_session: ApiSession;
  tipo: "ida" | "vuelta";
  ida_tarifa?: string; // Required for tipo=vuelta: Id + IdtarifaVuelta from cheapest ida fare
}

export interface ParsedTrayecto {
  train_number: string;
  train_name: string;
  dep_time: string;
  arr_time: string;
  duration: string;
  stops: number;
  origin_station: string;
  destination_station: string;
  fares: Array<{
    name: string; // "Básico", "Elige", etc.
    class_name: string; // "Estándar", "Confort"
    price: number; // total for all passengers
    allows_changes: boolean;
    allows_cancellation: boolean;
    available: boolean; // false if sold out (disponibilidad=9999)
    raw_id: string; // original Id field — needed to build ida_tarifa for vuelta
    raw_id_tarifa_vuelta: string; // IdtarifaVuelta field
  }>;
  min_price: number; // cheapest available fare total
}

/**
 * Builds the `cb` query parameter for vResults.php.
 *
 * Format: origin_id|dest_id|1|DD/MM/YYYY|DD/MM/YYYY|0|age-i-g-tn|age-i-g-tn|...||
 * Passengers sorted: children first (ascending age), then adults.
 */
function buildCbParam(
  originId: string,
  destId: string,
  outDate: string, // YYYY-MM-DD
  retDate: string | null,
  passengers: Passenger[],
): string {
  const outDDMM = toDDMMYYYY(outDate);
  const retDDMM = retDate ? toDDMMYYYY(retDate) : "";

  // Sort: children first (ascending age), then adults
  const sorted = [...passengers].sort((a, b) => a.age - b.age);

  const paxBlocks = sorted
    .map((p) => `${p.age}-${p.infant ?? 0}-${p.group ?? 0}-${p.card ?? 0}`)
    .join("|");

  return `${originId}|${destId}|1|${outDDMM}|${retDDMM}|0|${paxBlocks}||`;
}

function toDDMMYYYY(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Encodes ida_tarifa for the query string.
 * Matches browser behavior: encodes spaces (%20), accented chars (%C3%A1),
 * but preserves pipes (|) raw — the server expects them unencoded.
 */
function encodeIdaTarifa(value: string): string {
  if (!value) return "";
  return encodeURIComponent(value).replace(/%7C/g, "|");
}

/**
 * Fetches train results from trenes.com vResults.php API.
 *
 * Requires a valid sessiondb + cookies obtained manually from a browser session.
 * The same sessiondb can be reused across multiple date searches as long as
 * the PHP session hasn't expired.
 */
export async function fetchTrainResults(
  params: FetchTrainResultsParams,
): Promise<ParsedTrayecto[]> {
  const cb = buildCbParam(
    params.origin_id,
    params.destination_id,
    params.out_date,
    params.ret_date,
    params.passengers,
  );

  const tt = params.ret_date ? "0" : "1"; // 0=round-trip, 1=one-way

  // Build query string manually — trenes.com expects raw pipes and slashes
  // in the cb param, NOT percent-encoded.
  const qs = [
    `apV=21`,
    `si=0`,
    `v=1`,
    `tt=${tt}`,
    `cambios=0`,
    `anulaciones=0`,
    `directos=0`,
    `ida_tarifa=${encodeIdaTarifa(params.ida_tarifa ?? "")}`,
    `SQLComp=`,
    `tipo=${params.tipo}`,
    `orden=horario`,
    `ur=1`,
    `cb=${cb}`,
    `hi=`,
    `hv=`,
    `sessiondb=${params.api_session.sessiondb}`,
    `lang=es`,
    `IdPedido=`,
    `codigo=`,
    `opi=`,
    `opv=`,
    `rb=`,
    `tarifasSeleccionadas=`,
    `dv=`,
    `ppr=`,
  ].join("&");

  const path = `/apisTR/vResults.php?${qs}`;

  logger.info(
    `[TrenesCom] fetchTrainResults tipo=${params.tipo} path length=${path.length}`,
  );

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.trenes.com",
        path,
        method: "GET",
        headers: {
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
          Referer: "https://www.trenes.com/resultados/index.php",
          Cookie: params.api_session.cookies,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`vResults HTTP error: ${res.statusCode}`));
            return;
          }

          logger.info(
            `[TrenesCom] vResults raw response length: ${data.length}`,
          );

          try {
            // trenes.com PHP backend emits literal control characters inside
            // JSON string values (e.g. newlines in "subtitle" fields).
            // Strip all control chars (0x00-0x1F, 0x7F) — safe because JSON
            // structural whitespace (tabs/newlines between tokens) can be
            // replaced with spaces without affecting parsing.
            const sanitized = data.replace(/[\x00-\x1F\x7F]/g, " ");
            const response = JSON.parse(sanitized);

            // Response is an array with one element containing trayectos
            const container = Array.isArray(response) ? response[0] : response;
            const trayectos: any[] = container?.trayectos ?? [];

            if (trayectos.length === 0) {
              logger.warn(
                `[TrenesCom] 0 trayectos returned for tipo=${params.tipo}`,
              );
              resolve([]);
              return;
            }

            const parsed = trayectos
              .filter((t: any) => t.display === 1 || t.display === "1")
              .map(parseTrayecto)
              .filter((t) => t.fares.length > 0);

            logger.info(
              `[TrenesCom] Parsed ${parsed.length} trayectos (tipo=${params.tipo})`,
            );
            resolve(parsed);
          } catch (e: any) {
            logger.error(`[TrenesCom] vResults JSON parse error: ${e.message}`);
            logger.error(
              `[TrenesCom] Raw data (first 500 chars): ${data.slice(0, 500)}`,
            );
            reject(new Error(`vResults parse error: ${e.message}`));
          }
        });
      },
    );

    req.on("error", (e) =>
      reject(new Error(`vResults network error: ${e.message}`)),
    );
    req.end();
  });
}

function parseTrayecto(t: any): ParsedTrayecto {
  const fares: ParsedTrayecto["fares"] = [];

  for (const tab of t.tabs ?? []) {
    for (const opt of tab.options ?? []) {
      // Skip hidden/placeholder options
      if (opt.display === "0" || opt.display === 0) continue;

      const price = parseFloat(opt.precio ?? opt.price);
      if (isNaN(price) || price >= 9999) continue;

      const name = (opt.tarifaNombre ?? "").trim();
      if (!name) continue; // skip empty-name placeholders

      fares.push({
        name,
        class_name: (opt.claseNombre ?? "").trim(),
        price,
        allows_changes: opt.cambios === "1" || opt.cambios === 1,
        allows_cancellation: opt.anulaciones === "1" || opt.anulaciones === 1,
        available: !(
          opt.disponibilidad === "9999" || opt.disponibilidad === 9999
        ),
        raw_id: opt.Id ?? "",
        raw_id_tarifa_vuelta: (opt.IdtarifaVuelta ?? "").replace(/\|$/, ""), // strip trailing pipe
      });
    }
  }

  const availableFares = fares.filter((f) => f.available);
  const minPrice =
    availableFares.length > 0
      ? Math.min(...availableFares.map((f) => f.price))
      : fares.length > 0
        ? Math.min(...fares.map((f) => f.price))
        : 0;

  return {
    train_number: t.escalas?.[0]?.tren ?? "",
    train_name: (t.name ?? "").trim(),
    dep_time: t.origin?.time ?? "",
    arr_time: t.destination?.time ?? "",
    duration: t.info?.duration ?? "",
    stops: parseInt(t.numescalas ?? "0", 10),
    origin_station: t.origin?.station ?? "",
    destination_station: t.destination?.station ?? "",
    fares,
    min_price: minPrice,
  };
}

/**
 * Builds the `ida_tarifa` value needed for the vuelta API call
 * from the cheapest available fare of a single trayecto.
 * Format: {fare.raw_id}{fare.raw_id_tarifa_vuelta}|
 */
export function buildIdaTarifa(train: ParsedTrayecto): string | null {
  const cheapest = train.fares
    .filter((f) => f.available && f.raw_id)
    .sort((a, b) => a.price - b.price)[0];

  if (!cheapest) return null;

  return `${cheapest.raw_id}${cheapest.raw_id_tarifa_vuelta}|`;
}
