// extensions/flight-tools/src/strategies/kayak-train-url.ts
// Builds Kayak train-only search URLs using the transportation filter.

export function buildKayakTrainUrl(params: {
  origin:      string;
  destination: string;
  out_date:    string;
  ret_date?:   string | null;
  adults:      number;
  children?:   number[];
}): string {
  const org = params.origin.toUpperCase();
  const dst = params.destination.toUpperCase();

  const datePart = params.ret_date
    ? `${params.out_date}/${params.ret_date}`
    : params.out_date;

  const childAges = params.children ?? [];
  const paxPart = childAges.length > 0
    ? `${params.adults}adults/children-${childAges.join('-')}`
    : `${params.adults}adults`;

  // Train-only filter: transportation_train_bus, direct only, sorted by price
  const qs = 'sort=price_a&fs=stops%3D~0%3Btransportation%3D-transportation_train_bus';

  return `https://www.kayak.es/flights/${org}-${dst}/${datePart}/${paxPart}?${qs}`;
}
