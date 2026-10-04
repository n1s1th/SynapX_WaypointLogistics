/**
 * Sri Lanka time for the driver screens, whatever timezone the phone is set to.
 * Orders close at 4 PM and dispatch then plans the next day's trips.
 */
const TIME_ZONE = "Asia/Colombo";

/** Drivers confirm tomorrow's availability before dispatch plans at the 4 PM cutoff. */
export const READY_CUTOFF_HOUR = 16;

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Good morning" / "Good afternoon" / "Good evening" for an "HH:MM" Sri Lanka time. */
export function greeting(hhmm: string) {
  const hour = Number(hhmm.slice(0, 2));
  if (Number.isNaN(hour)) return "Hello";
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function colomboNow(date = new Date()) {
  const part = Object.fromEntries(FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateKey: `${part.year}-${part.month}-${part.day}`,
    hour: Number(part.hour),
    hhmm: `${part.hour}:${part.minute}`,
  };
}
