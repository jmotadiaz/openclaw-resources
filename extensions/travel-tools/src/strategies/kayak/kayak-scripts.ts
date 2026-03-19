// extensions/flight-tools/src/strategies/kayak-scripts.ts
// DOM extraction scripts for Kayak flight & train results pages.
// Kayak renders identical card markup (.nrc6) for both product types;
// the only difference is the transport mode in the URL.

export const KAYAK_DUMP_HTML_JS = `
(() => {
  return JSON.stringify({
    title: document.title,
    url:   window.location.href,
    html:  document.documentElement.outerHTML
  });
})()
`;

export const KAYAK_ACCEPT_COOKIES_JS = `
(() => {
  const selectors = [
    '#onetrust-accept-btn-handler',
    '[id*="accept-cookie"]',
    '[id*="cookie-accept"]',
    '[class*="accept-cookie"]',
    'button[aria-label*="Accept"]',
    'button[aria-label*="aceptar" i]'
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  return false;
})()
`;

/**
 * Probe whether real result cards are loaded.
 * Returns { total, real } — "real" excludes shimmer/skeleton cards.
 * A card is considered "real" when it contains at least one .vmXl element
 * (which holds departure/arrival times).
 */
export const KAYAK_CHECK_LOADED_JS = `
(() => {
  const cards = document.querySelectorAll('.nrc6');
  const real  = [...cards].filter(c => c.querySelector('.vmXl'));
  return JSON.stringify({ total: cards.length, real: real.length });
})()
`;

/**
 * Extract flight/train results from a fully-loaded Kayak results page.
 *
 * Card structure (same for flights and trains):
 *   .nrc6                        – result card
 *     .nrc6-mod-sponsored-result – skip sponsored ads
 *     .hJSA-list > .hJSA-item   – one item per leg (outbound / return)
 *       .aVdy input[aria-label]  – "Trayecto N: Airline, ORG HH:MM - DST HH:MM"
 *       .c5iUd img[alt]          – carrier logo alt text
 *       .vmXl.vmXl-mod-variant-large spans – dep / arr times
 *       .JWEO .vmXl              – stops text ("directo" / "0 cambios" / "1 escala")
 *       .xdW8 .vmXl              – duration
 *     .J0g6-operator-text        – operator name(s)
 *     .e2GB-price-text           – price per person
 *     .f8F1-multiple-ptc-price-label – total price label (e.g. "Total: 650 €")
 */
export const KAYAK_EXTRACT_RESULTS_JS = `
(() => {
  try {
    const results = [];
    const cards   = document.querySelectorAll('.nrc6');

    cards.forEach((card, i) => {
      if (i >= 20) return;

      // Skip pure-ad banners (sponsored overlays with no real leg data)
      if (card.classList.contains('nrc6-mod-sponsored-result')) return;

      // Skip skeleton / loading cards
      if (!card.querySelector('.vmXl')) return;

      const legs = [...card.querySelectorAll('.hJSA-item')].map(item => {
        // --- carrier ---
        const carrierImg = item.querySelector('.c5iUd img[alt]');
        const airline    = carrierImg ? carrierImg.getAttribute('alt') || 'Unknown' : 'Unknown';

        // --- times ---
        const timeEl  = item.querySelector('.vmXl.vmXl-mod-variant-large');
        const spans   = timeEl ? [...timeEl.querySelectorAll('span')].filter(s => !s.classList.contains('aOlM') && s.innerText.trim()) : [];
        const depTime = spans[0]?.innerText?.trim() || '';
        const arrTime = spans[1]?.innerText?.trim() || '';

        // --- stops ---
        const stopsEl   = item.querySelector('.JWEO .vmXl');
        const stopsText = stopsEl?.innerText?.trim() || '';
        let stops = 1;
        if (/directo|0 cambios/i.test(stopsText)) stops = 0;
        else {
          const m = stopsText.match(/\\d+/);
          stops = m ? parseInt(m[0]) : 1;
        }

        // --- duration ---
        const durEl  = item.querySelector('.xdW8 .vmXl');
        const duration = durEl?.innerText?.trim() || '';

        return { airline, depTime, arrTime, stops, duration };
      });

      if (legs.length === 0) return;

      // --- operator label (may differ from logo alt) ---
      const operatorEl = card.querySelector('.J0g6-operator-text');
      const operator   = operatorEl?.innerText?.trim() || legs.map(l => l.airline).join(' + ');

      // --- price per person (e.g. "15 €") ---
      const priceEl     = card.querySelector('.e2GB-price-text');
      const pricePerPax = priceEl ? priceEl.innerText.replace(/[^\\d.,]/g, '').replace(',', '.').trim() : null;

      // --- total price label (e.g. "Total: 45 €") — preferred source ---
      // Present when pax > 1. Parse the numeric value directly from the label.
      // Structure: <div class="f8F1-multiple-ptc-price-label">Total: 45&nbsp;€</div>
      const totalEl  = card.querySelector('.f8F1-multiple-ptc-price-label');
      const totalRaw = totalEl ? totalEl.innerText.trim() : null;
      let totalPrice = null;
      if (totalRaw) {
        const m = totalRaw.match(/[\\d]+(?:[.,][\\d]+)?/);
        if (m) totalPrice = parseFloat(m[0].replace(',', '.'));
      }

      // Determine transport type via label badge
      const badgeEl   = card.querySelector('.z6uD');
      const badgeText = badgeEl?.innerText?.trim() || '';
      const isTrain   = /tren/i.test(badgeText);

      results.push({
        operator,
        pricePerPax,  // per-person string — used as fallback when totalPrice is null
        totalPrice,   // already-computed total directly from DOM (preferred)
        isTrain,
        legs
      });
    });

    return JSON.stringify({ count: cards.length, results });
  } catch(e) {
    return JSON.stringify({ error: e.toString() });
  }
})()
`;

/**
 * Lightweight calendar price extractor for Kayak's date picker.
 * Kayak does not expose a dedicated month-view like Skyscanner, so we
 * scrape the flex-date grid that appears when the user opens the date
 * selector. This script is optional; scrapeFlights is the primary tool.
 */
export const KAYAK_EXTRACT_CALENDAR_JS = `
(() => {
  // Kayak flex-date cells: each has a day number and a price
  const cells = document.querySelectorAll('[class*="FlexDate"] [class*="day"]');
  if (cells.length === 0) return JSON.stringify({ count: 0, dates: [] });

  const dates = [];
  cells.forEach(cell => {
    const dayEl   = cell.querySelector('[class*="dayNum"], [class*="day-num"]');
    const priceEl = cell.querySelector('[class*="price"]');
    if (dayEl && priceEl) {
      const priceText = priceEl.innerText.replace(/\\s/g, '').trim();
      if (priceText && priceText !== '-' && priceText !== '—') {
        dates.push({ day: dayEl.innerText.trim(), price: priceText });
      }
    }
  });

  return JSON.stringify({ count: dates.length, dates });
})()
`;

/**
 * Check whether Kayak's search progress bar has finished loading.
 * Kayak shows a <div class="skp2 skp2-inlined" role="progressbar"> while
 * results are loading. When the search completes the element gains the
 * class "skp2-hidden". Loading is considered done when either:
 *   (a) the progress bar is present AND has class skp2-hidden, OR
 *   (b) the progress bar element is gone entirely (removed from DOM).
 * Returns { done: boolean, found: boolean }
 */
export const KAYAK_CHECK_PROGRESS_DONE_JS = `
(() => {
  const bar = document.querySelector('.skp2');
  if (!bar) return JSON.stringify({ done: true, found: false });
  const done = bar.classList.contains('skp2-hidden');
  return JSON.stringify({ done, found: true });
})()
`;

/**
 * Two-phase readiness check:
 *   Phase 1 — progress bar must be gone / hidden (.skp2-hidden)
 *   Phase 2 — at least one real card (.nrc6 with .vmXl) must be present
 * Returns { progressDone: boolean, cardsReady: boolean, realCount: number }
 */
export const KAYAK_CHECK_READY_JS = `
(() => {
  const bar = document.querySelector('.skp2');
  // Bar not found = page still loading = NOT ready
  const progressDone = bar ? bar.classList.contains('skp2-hidden') : false;

  const cards = document.querySelectorAll('.nrc6');
  const real  = [...cards].filter(c => c.querySelector('.vmXl'));

  return JSON.stringify({
    progressDone,
    cardsReady: progressDone && real.length > 0,
    realCount:  real.length
  });
})()
`;
