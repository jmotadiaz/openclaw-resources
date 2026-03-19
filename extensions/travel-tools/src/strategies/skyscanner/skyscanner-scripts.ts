export const DUMP_HTML_JS = `
(() => {
  return JSON.stringify({
    title: document.title,
    url:   window.location.href,
    html:  document.documentElement.outerHTML
  });
})()
`;

export const PROBE_SELECTORS_JS = `
(() => {
  const candidates = [
    ".month-view-calendar__cell",
    "[data-testid='month-view-cell']",
    "[class*='MonthViewCell']",
    "[class*='CalendarCell']",
    "[class*='calendar-cell']",
    "[class*='day--']",
    "[class*='DayCell']",
    "[data-testid='ticket']",
    "[data-backpack-ds-component='Card']"
  ];
  const hits = {};
  candidates.forEach(sel => {
    try { hits[sel] = document.querySelectorAll(sel).length; }
    catch(e) { hits[sel] = "ERROR: " + e.message; }
  });
  return JSON.stringify(hits);
})()
`;

export const EXTRACT_DATES_JS = `
(() => {
  const results = [];
  const cells = document.querySelectorAll(".month-view-calendar__cell");

  cells.forEach(cell => {
    const dateEl = cell.querySelector(".date");
    const priceEl = cell.querySelector(".price");

    if (dateEl && priceEl) {
      const priceText = priceEl.innerText.trim();
      if (priceText && priceText !== "-" && priceText !== "—" && priceText !== "") {
        results.push({
          day: dateEl.innerText.trim(),
          price: priceText
        });
      }
    }
  });

  return JSON.stringify({ count: results.length, dates: results });
})()
`;

export const ACCEPT_COOKIES_JS = `
(() => {
  const btn = document.querySelector('#acceptCookieButton') || 
              document.querySelector('[id*="cookie-accept"]') ||
              document.querySelector('[id*="accept-cookie"]');
  if (btn) {
      (btn as any).click();
      return true;
  }
  return false;
})()
`;

export const EXTRACT_RESULTS_JS = `
(() => {
  try {
    const results = [];
    const cards = document.querySelectorAll("[data-testid='ticket']");
    cards.forEach((card, i) => {
      if (i >= 15) return;
      if (card.querySelector("[data-testid='ShimmerLeg']")) return;

      const legs = [...card.querySelectorAll("[class*='LegDetails_container']")].map(leg => {
          const airline = leg.querySelector("img[alt]")?.getAttribute("alt") || "Unknown";
          const depTime = leg.querySelector("[class*='routePartialDepart'] [class*='subheading']")?.innerText?.trim() || "";
          const arrTime = leg.querySelector("[class*='routePartialArrive'] [class*='subheading']")?.innerText?.trim() || "";
          const duration = leg.querySelector("[class*='Stops_stopsContainer'] [class*='caption']")?.innerText?.trim() || "";
          const stopsText = leg.querySelector("[class*='Stops_stopsLabel']")?.innerText || "";
          const stops = /direct/i.test(stopsText) ? 0 : parseInt(stopsText.match(/\\d/)?.[0] || "1");
          return { airline, depTime, arrTime, duration, stops };
      });

      if (legs.length > 0) {
          const airline = Array.from(new Set(legs.map(l => l.airline))).join(" + ");
          const departure = legs.map(l => l.depTime).join(" | ");
          const arrival = legs.map(l => l.arrTime).join(" | ");
          const duration = legs.map(l => l.duration).join(" | ");
          const stops = Math.max(...legs.map(l => l.stops));

          const priceText = card.querySelector("[class*='Price_mainPriceContainer'] [class*='heading']")?.innerText?.trim()
                         || card.querySelector("[class*='Price'], [class*='price']")?.innerText?.trim() || null;

          results.push({ airline, departure, arrival, duration, stops, price: priceText });
      }
    });
    return JSON.stringify({ count: cards.length, flights: results });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
})()
`;

export const CHECK_SHIMMER_JS = `
(() => {
  const cards = document.querySelectorAll("[data-testid='ticket']");
  const real = [...cards].filter(c => !c.querySelector("[data-testid='ShimmerLeg']"));
  return JSON.stringify({ total: cards.length, real: real.length });
})()
`;
