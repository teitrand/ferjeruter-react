/** Dato og klokke i Oslo for eit tidspunkt (ms). */
const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function osloParts(ms) {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}

export const osloDate = (ms) => osloParts(ms).date;
