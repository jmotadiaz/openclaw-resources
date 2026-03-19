import { FlightScraperStrategy, ScoutParams, SearchParams, ScraperResult } from '../FlightScraperStrategy';
import { FlightDB, ItineraryRecord, FlightOptionRecord } from '../../utils/db';
import { logger } from '../../utils/logger';
import { McpBrowserSession } from '../../utils/mcp-browser';
import * as scripts from './skyscanner-scripts';

export class SkyscannerStrategy implements FlightScraperStrategy {

  async scoutDates(params: ScoutParams): Promise<ScraperResult> {
    const db = new FlightDB(params.dbPath);
    // IMPORTANTE: Pasamos un prefijo único para que cree su perfil dinámico
    const browser = new McpBrowserSession(`skyscanner-dates-${params.month}`);

    try {
      logger.info(`Iniciando scoutDates aislado para ${params.origin}->${params.destination} (${params.month})`);
      await this.startBrowser(browser);

      const skyscannerMonth = params.month.substring(2).replace('-', ''); // "2026-07" -> "2607"
      const url = `https://www.skyscanner.es/transport/flights/${params.origin}/${params.destination}/?adultsv2=1&cabinclass=economy&rtn=0&preferdirects=false&oym=${skyscannerMonth}&selectedoday=01`;

      await browser.callTool("navigate", {
        instance_id: browser.instance_id,
        url,
        wait_until: "domcontentloaded",
        timeout: 45000
      });

      let success = false;
      for (let i = 0; i < 20; i++) {
        const probe = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.PROBE_SELECTORS_JS });
        const hits = typeof probe.result === 'string' ? JSON.parse(probe.result) : (probe.result || probe.value || {});
        if (Object.values(hits).some((n: any) => typeof n === 'number' && n > 0)) {
          success = true;
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
        await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.ACCEPT_COOKIES_JS });
      }

      if (!success) throw new Error("Calendar selector never appeared");

      const extract = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.EXTRACT_DATES_JS });
      const data = typeof extract.result === 'string' ? JSON.parse(extract.result) : (extract.result || extract.value || {});
      const dates = data.dates || [];

      if (dates.length === 0) {
        throw new Error("No se extrajeron fechas del calendario");
      }

      for (const d of dates) {
        const price = parseFloat(d.price.replace(/[^\d.,]/g, '').replace(',', '.'));
        if (isNaN(price)) continue;

        const day = d.day.padStart(2, '0');
        const isoDate = `${params.month}-${day}`;

        db.insertScout({
          site: 'skyscanner',
          origin: params.origin,
          destination: params.destination,
          month: params.month,
          date: isoDate,
          price,
          session_id: params.session_id
        });
      }

      return { status: 'success', summary: `Extraídas ${dates.length} fechas para ${params.origin}->${params.destination} en ${params.month}`, url };

    } catch (e: any) {
      logger.error(`Error en scoutDates: ${e.message}`);
      db.logError('skyscanner', params.session_id, 'scoutDates', e.message);
      return { status: 'error', reason: e.message };
    } finally {
      // El finally garantiza que el proceso Python muera siempre y libere recursos
      await browser.close();
      db.close();
    }
  }

  async scrapeFlights(params: SearchParams): Promise<ScraperResult> {
    const db = new FlightDB(params.dbPath);
    const browser = new McpBrowserSession(`skyscanner-search-${params.origin}-${params.destination}-${params.exact_date}`);

    try {
      const outDateStr = params.exact_date.replace(/-/g, '').substring(2);
      let url = `https://www.skyscanner.es/transport/flights/${params.origin}/${params.destination}/${outDateStr}/?adultsv2=${params.pax}&rtn=0&stops=!oneStop,!twoPlusStops`;

      if (params.return_date) {
         const retDateStr = params.return_date.replace(/-/g, '').substring(2);
         url = `https://www.skyscanner.es/transport/flights/${params.origin}/${params.destination}/${outDateStr}/${retDateStr}/?adultsv2=${params.pax}&rtn=1&stops=!oneStop,!twoPlusStops`;
         logger.info(`[URL] Modo Round Trip activado`);
      }

      logger.info(`[Skyscanner] scrapeFlights para ${params.pax} pasajeros: ${params.origin}->${params.destination} (${params.exact_date}${params.return_date ? ' / ' + params.return_date : ''})`);
      logger.info(`[URL] Navegando a: ${url}`);

      await this.startBrowser(browser);
      await browser.callTool("navigate", {
        instance_id: browser.instance_id,
        url,
        wait_until: "networkidle",
        timeout: 60000
      });

      let success = false;
      for (let i = 0; i < 25; i++) {
        const check = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.CHECK_SHIMMER_JS });
        const data = typeof check.result === 'string' ? JSON.parse(check.result) : (check.result || check.value || {});
        if (data.real > 0) {
          success = true;
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!success) {
        // Si hay timeout, vemos qué página es realmente
        const dump = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.DUMP_HTML_JS });
        const dumpData = typeof dump.result === 'string' ? JSON.parse(dump.result) : (dump.result || dump.value || {});
        logger.error(`Shimmer Timeout. Título de la página actual: "${dumpData.title}"`);
        throw new Error(`Flight cards never loaded (shimmer timeout). Page Title: "${dumpData.title}"`);
      }

      const extract = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.EXTRACT_RESULTS_JS });
      const data = typeof extract.result === 'string' ? JSON.parse(extract.result) : (extract.result || extract.value || {});

      // 2. DETECCIÓN DE CRASH EN JS
      if (data.error) {
        logger.error(`Error interno del DOM JS: ${data.error}`);
        throw new Error(`DOM JS Error: ${data.error}`);
      }

      const flights = data.flights || [];

      // 3. DETECCIÓN DE 0 VUELOS REALES
      if (flights.length === 0) {
        const dump = await browser.callTool("execute_script", { instance_id: browser.instance_id, script: scripts.DUMP_HTML_JS });
        const dumpData = typeof dump.result === 'string' ? JSON.parse(dump.result) : (dump.result || dump.value || {});
        logger.warn(`Se encontraron 0 vuelos. Título de la página: "${dumpData.title}". URL: ${url}`);
        return { status: 'error', reason: `0 vuelos encontrados. Posible Captcha o sin rutas. Título: ${dumpData.title}`, url };
      }

      // Upsert the itinerary record and get its id
      const itinerary_id = db.upsertItinerary({
        session_id:  params.session_id,
        site:        'skyscanner',
        origin:      params.origin,
        destination: params.destination,
        out_date:    params.exact_date,
        ret_date:    params.return_date ?? null,
        pax:         params.pax,
        search_url:  url
      });

      // Insert each flight option as an independent row
      for (const f of flights) {
        // Split pipe-separated leg data produced by EXTRACT_RESULTS_JS
        const depParts = f.departure.split('|').map((t: string) => t.trim());
        const arrParts = f.arrival.split('|').map((t: string) => t.trim());
        const durParts = f.duration.split('|').map((t: string) => t.trim());

        const rawPrice = f.price?.replace(/[^\d.,]/g, '').replace(',', '.') ?? '0';
        const total_price = parseFloat(rawPrice) * params.pax;
        if (isNaN(total_price) || total_price === 0) continue;

        db.insertFlightOption(itinerary_id, {
          airline:      f.airline ?? 'Unknown',
          total_price,
          out_dep_time: depParts[0] ?? '',
          out_arr_time: arrParts[0] ?? '',
          out_duration: durParts[0] ?? null,
          out_stops:    f.stops ?? 0,
          ret_dep_time: depParts[1] ?? null,
          ret_arr_time: arrParts[1] ?? null,
          ret_duration: durParts[1] ?? null,
          ret_stops:    depParts[1] ? (f.stops ?? 0) : null
        });
      }

      // 4. DEVOLVER LA URL AL LLM
      return {
        status: 'success',
        summary: `Encontrados ${flights.length} vuelos para ${params.origin}->${params.destination} el ${params.exact_date}`,
        url
      };

    } catch (e: any) {
      logger.error(`Error en scrapeFlights: ${e.message}`);
      db.logError('skyscanner', params.session_id, 'scrapeFlights', e.message);
      return { status: 'error', reason: e.message };
    } finally {
      await browser.close();
      db.close();
    }
  }

  private async startBrowser(browser: McpBrowserSession) {
    const jitter = Math.floor(Math.random() * 2000); // 0–2s
    await new Promise(r => setTimeout(r, jitter));
    return await browser.start();
  }
}
