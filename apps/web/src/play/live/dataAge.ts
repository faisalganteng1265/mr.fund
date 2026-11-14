import { useEffect, useState } from "react";

/** "Updated 13 s ago", switching to minutes from 60 s. Whole units, rounded down. */
export function formatDataAge(ageMs: number): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(ageMs) ? ageMs : 0) / 1000);
  return seconds < 60 ? `Updated ${seconds} s ago` : `Updated ${Math.floor(seconds / 60)} min ago`;
}

/**
 * Age of a live read: the age the server reported plus the time this browser has held the data.
 * `token` identifies the read (the position or card object); a new token restarts the clock at
 * its own reported age. Text updates once per second and never animates.
 */
export function useDataAge(reportedAgeMs: number, token: object, clock = Date.now): string {
  const [anchor, setAnchor] = useState(() => ({ token, at: clock() }));
  if (anchor.token !== token) setAnchor({ token, at: clock() });
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [clock]);
  const sinceRead = anchor.token === token ? Math.max(0, now - anchor.at) : 0;
  return formatDataAge(reportedAgeMs + sinceRead);
}
