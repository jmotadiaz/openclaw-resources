// extensions/flight-tools/src/strategies/kayak-flight-url.ts
// Builds Kayak flight search URLs with correct per-child-age passenger segment.

export function buildKayakFlightUrl(params: {
  origin:      string;
  destination: string;
  out_date:    string;
  ret_date?:   string | null;
  adults:      number;
}): string {
  const org = params.origin.toUpperCase();
  const dst = params.destination.toUpperCase();

  const datePart = params.ret_date
    ? `${params.out_date}/${params.ret_date}`
    : params.out_date;

  const paxPart = `${params.adults}adults`;

  // Direct flights, sorted by best
  const qs = 'fs=stops%3D~0&sort=bestflight_a';

  return `https://www.kayak.es/flights/${org}-${dst}/${datePart}/${paxPart}?${qs}`;
}
