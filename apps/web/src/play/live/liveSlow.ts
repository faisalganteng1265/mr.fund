/**
 * `slow` is added to `useLiveConsultation` by the chat-backend change (design.md contract 1).
 * Read it through this guard so the UI works before and after that field exists.
 */
export const isSlow = (live: object): boolean =>
  "slow" in live && (live as { slow: unknown }).slow === true;
