// extensions/travel-tools/src/strategies/yescapa/YescapaStrategy.ts

import * as https from 'https';
import * as fs   from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { FlightDB } from '../../utils/db';
import { BaseBatchCamperStrategy } from '../BaseBatchStrategy';
import {
  CamperSearchParams,
  CamperScraperResult,
} from '../CamperScraperStrategy';

interface LocationResult {
  where: string;
  latitude: number;
  longitude: number;
  radius: number;
}

interface SearchUrlParams {
  where: string;
  latitude: number;
  longitude: number;
  radius: number;
  date_from: string;
  date_to: string;
  page?: number;
  types?: number[];
  seatbelts?: number;
  beds?: number;
  equipment?: string[];
}

const HOME_URL = 'https://www.yescapa.es/';

const REGEX_PRIMARY = /"url"\s*:\s*"https:\/\/api\.jelouemoncampingcar[^"]*"\s*,\s*"key"\s*:\s*"([^"]+)"/;
const REGEX_FALLBACK_1 = /jelouemoncampingcar[^}]{0,200}"key"\s*:\s*"([A-Za-z0-9\-_\.]{20,})"/;
const REGEX_FALLBACK_2 = /api[^}]{0,50}jelouemoncampingcar[^}]{0,200}"([A-Za-z0-9\-_\.]{30,})"/;

export class YescapaStrategy extends BaseBatchCamperStrategy {
  private logsDir = path.resolve(__dirname, '../../../logs');

  constructor() {
    super();
    if (!fs.existsSync(this.logsDir)) {
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
      } catch (e: any) {
        logger.error(`[Yescapa] Error creating logs dir: ${e.message}`);
      }
    }
  }

  async scrapeCampers(params: CamperSearchParams): Promise<CamperScraperResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const equipment = params.equipment.length > 0 ? params.equipment : ["ac", "shower_int", "fridge"];
    
    try {
      // Paso 1 — Fetch del HTML de la home para extraer API key
      logger.info("[Yescapa/L1] Fetching home para extraer x-api-key...");
      const html = await this.fetchHtml(HOME_URL);
      const apiKey = this.extractApiKey(html);

      if (!apiKey) {
        const dumpPath = path.join(this.logsDir, `yescapa-home-${timestamp}.html`);
        fs.writeFileSync(dumpPath, html, 'utf8');
        logger.warn(`[Yescapa/L1] x-api-key no encontrada. HTML volcado a: ${dumpPath}`);
        throw new Error('x-api-key not found in HTML');
      }

      logger.info(`[Yescapa/L1] x-api-key encontrada: ${apiKey.slice(0, 8)}...`);

      // Paso 2 — Resolver localización
      logger.info(`[Yescapa/L1] Resolviendo localización para: ${params.city}`);
      const loc = await this.resolveLocation(params.city, apiKey);
      logger.info(`[Yescapa/L1] Localización resuelta: where="${loc.where}" lat=${loc.latitude} lng=${loc.longitude} radius=${loc.radius}`);

      // Paso 3 — Bucle de paginación (Páginas 1 y 2)
      const allResults: any[] = [];
      let totalCount = 0;
      let firstPageSearchUrl = '';

      for (const page of [1, 2]) {
        const searchUrl = this.buildSearchUrl({
          ...loc,
          date_from: params.date_from,
          date_to: params.date_to,
          types: params.types.length > 0 ? params.types : undefined,
          seatbelts: params.seatbelts ?? undefined,
          beds: params.beds ?? undefined,
          equipment: equipment,
          page: page
        });

        if (page === 1) firstPageSearchUrl = searchUrl;

        const apiUrl = searchUrl.replace('https://www.yescapa.es/s', 'https://api.jelouemoncampingcar.com/3/campers/search/') 
          + `&page_size=20&for_search=true`;
        
        logger.info(`[Yescapa/L1] Llamando API Página ${page}: ${apiUrl}`);
        const json = await this.fetchJson(apiUrl, apiKey);
        const data = JSON.parse(json);

        const jsonPath = path.join(this.logsDir, `yescapa-response-p${page}-${timestamp}.json`);
        fs.writeFileSync(jsonPath, json, 'utf8');
        
        const pageResults = data.results || [];
        logger.info(`[Yescapa/L1] Página ${page}: ${pageResults.length} resultados. Disco: ${jsonPath}`);

        allResults.push(...pageResults);
        if (page === 1) totalCount = data.count || 0;

        if (!data.next) break;
      }

      logger.info(`[Yescapa/L1] Total combinado: ${allResults.length} resultados`);

      // Paso 4 — Persistencia en BD
      const db = new FlightDB(params.dbPath);
      let savedCount = 0;
      try {
        const itineraryId = db.upsertCamperItinerary({
          session_id:  params.session_id,
          city:        params.city,
          where_label: loc.where,
          latitude:    loc.latitude,
          longitude:   loc.longitude,
          radius:      loc.radius,
          date_from:   params.date_from,
          date_to:     params.date_to,
          types:       params.types ?? null,
          seatbelts:   params.seatbelts ?? null,
          beds:        params.beds ?? null,
          equipment:   equipment,
          total_count: totalCount,
          search_url:  firstPageSearchUrl
        });

        for (const res of allResults) {
          db.insertCamperOption(itineraryId, {
            camper_id:       res.id,
            ad_url:          res.ad_url,
            title:           res.title,
            vehicle_type:    res.vehicle_type,
            seats:           res.vehicle_seats,
            beds:            res.vehicle_beds,
            price_per_day:   res.price_per_day,
            total_price:     res.final_booking_price,
            instant_booking: !!res.instant_booking_activated,
            rating:          res.display_review_average,
            rating_count:    res.review_count
          });
          savedCount++;
        }
      } finally {
        db.close();
      }

      return {
        status:      'success',
        city:        params.city,
        date_from:   params.date_from,
        date_to:     params.date_to,
        search_url:  firstPageSearchUrl,
        total_count: totalCount,
        saved:       savedCount
      };

    } catch (e: any) {
      logger.error(`[Yescapa/L1] Failed: ${e.message}`);
      return {
        status:      'error',
        city:        params.city,
        date_from:   params.date_from,
        date_to:     params.date_to,
        search_url:  '',
        total_count: 0,
        saved:       0,
        reason:      e.message
      };
    }
  }

  private async resolveLocation(city: string, apiKey: string): Promise<LocationResult> {
    const searchUrl = `https://api.jelouemoncampingcar.com/3/search_locations/?search=${encodeURIComponent(city)}&language=es`;
    const searchRes = JSON.parse(await this.fetchJson(searchUrl, apiKey));
    
    if (!searchRes || !searchRes[0]) {
      throw new Error(`Could not find location for city: ${city}`);
    }

    const { title, locationId } = searchRes[0];

    const infoUrl = `https://api.jelouemoncampingcar.com/3/info_location/?location_id=${encodeURIComponent(locationId)}`;
    const infoRes = JSON.parse(await this.fetchJson(infoUrl, apiKey));

    return {
      where:     title,
      latitude:  infoRes.displayPosition.latitude,
      longitude: infoRes.displayPosition.longitude,
      radius:    infoRes.radius || 50000
    };
  }

  private buildSearchUrl(params: SearchUrlParams): string {
    const url = new URL('https://www.yescapa.es/s');
    url.searchParams.set('date_from', params.date_from);
    url.searchParams.set('date_to', params.date_to);
    url.searchParams.set('where', params.where);
    url.searchParams.set('latitude', params.latitude.toString());
    url.searchParams.set('longitude', params.longitude.toString());
    url.searchParams.set('radius', params.radius.toString());
    url.searchParams.set('page', (params.page || 1).toString());

    if (params.types && params.types.length > 0) {
      params.types.forEach(t => url.searchParams.append('types', t.toString()));
    }
    if (params.seatbelts != null) {
      url.searchParams.set('seatbelts', params.seatbelts.toString());
    }
    if (params.beds != null) {
      url.searchParams.set('beds', params.beds.toString());
    }
    if (params.equipment && params.equipment.length > 0) {
      params.equipment.forEach(e => url.searchParams.set(e, 'true'));
    }

    return url.toString();
  }

  private fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; travel-tools/0.1)',
          'Accept': 'text/html'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  private extractApiKey(html: string): string | null {
    for (const regex of [REGEX_PRIMARY, REGEX_FALLBACK_1, REGEX_FALLBACK_2]) {
      const match = html.match(regex);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  private fetchJson(url: string, apiKey: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; travel-tools/0.1)',
          'Referer': 'https://www.yescapa.es/'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 403) {
            reject(new Error(`403 Cloudflare — statusCode=${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      }).on('error', reject);
    });
  }
}

