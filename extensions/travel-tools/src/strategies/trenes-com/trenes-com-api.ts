import * as https from 'https';
import { logger } from '../../utils/logger';

export interface StationResult {
  id:   string;   // numeric string, e.g. "10865"
  name: string;   // e.g. "Madrid Atocha"
}

export interface DayPrice {
  date:  string;  // "YYYY-MM-DD"
  price: number;
}

/**
 * Resolves a city name to a numeric station ID using trenes.com API.
 */
export async function resolveStation(cityName: string): Promise<StationResult> {
  const body = `key=${encodeURIComponent(cityName)}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.trenes.com',
      path: '/webVersions/v21/apis/getEstaciones.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (compatible; travel-tools/0.1)',
        'Referer': 'https://www.trenes.com/',
        'Origin': 'https://www.trenes.com',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`getEstaciones HTTP error: ${res.statusCode}`));
          return;
        }

        // --- Log the raw response body as requested ---
        logger.info(`[TrenesCom] resolveStation raw response for '${cityName}': ${data}`);

        try {
          const response = JSON.parse(data);
          if (response.result !== 'ok') {
            reject(new Error('getEstaciones failed: ' + data));
            return;
          }

          const stationsObj = response.stations;
          if (!stationsObj || Object.keys(stationsObj).length === 0) {
            reject(new Error('station_not_found: ' + cityName));
            return;
          }

          const groups = Object.values(stationsObj) as any[];
          
          for (const group of groups) {
            if (!group.estaciones) continue;
            
            // 1. Try to match the key from 'todas' where value is "1"
            if (group.todas) {
              for (const [key, val] of Object.entries(group.todas)) {
                if (val === "1" && group.estaciones[key]) {
                  resolve({ id: group.estaciones[key], name: group.ciudad });
                  return;
                }
              }
            }

            // 2. Fallback: If 'todas' matched a key that doesn't exist in 'estaciones' (like "0"),
            // or if we just want the first station of this group.
            const firstStationId = Object.values(group.estaciones)[0] as string;
            if (firstStationId) {
              resolve({ id: firstStationId, name: group.ciudad });
              return;
            }
          }

          reject(new Error('station_not_found: ' + cityName));
        } catch (e: any) {
          reject(new Error('api_auth_required: response is not JSON — cookies may be needed'));
        }
      });
    });

    req.on('error', (e) => reject(new Error('getEstaciones network error: ' + e.message)));
    req.write(body);
    req.end();
  });
}

/**
 * Fetches monthly prices for a route via trenes.com API.
 */
export async function fetchMonthlyPrices(origen: string, destino: string, mes: number, ano: number): Promise<DayPrice[]> {
  const urlParams = `?mes=${mes}&origen=${origen}&destino=${destino}&trayecto=I&ano=${ano}`;
  const path = `/webVersions/v21/apis/getPreciosDia.php${urlParams}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.trenes.com',
      path,
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (compatible; travel-tools/0.1)',
        'Referer': 'https://www.trenes.com/',
        'Origin': 'https://www.trenes.com'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`getPreciosDia HTTP error: ${res.statusCode}`));
          return;
        }

        // --- Log the raw response body as requested ---
        logger.info(`[TrenesCom] fetchMonthlyPrices raw response: ${data}`);

        try {
          const response = JSON.parse(data);

          if (Object.keys(response).length === 0) {
            resolve([]);
            return;
          }

          if (response.result !== undefined) {
             reject(new Error('getPreciosDia unexpected format: ' + data));
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
          reject(new Error('getPreciosDia JSON parse error: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(new Error('getPreciosDia network error: ' + e.message)));
    req.end();
  });
}
