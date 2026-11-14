import type { LivePositionState } from "../source/livePosition";

type Status = LivePositionState["status"];

/** Opening line from Mr.Fund for the live chat. Copy only: no figure appears here. */
export function liveGreeting(status: Status): string {
  switch (status) {
    case "ready":
      return "Hi, I'm Mr.Fund. I've read your Rhea position. Ask me anything about it, or pick a question below.";
    case "empty":
      return "Hi, I'm Mr.Fund. I don't see a Rhea lending position on this account yet. I can still explain how health, debt and Guardian work.";
    case "stale":
      return "Your position data is out of date. Refresh it first so I answer from what's on the chain now.";
    case "unavailable":
      return "I can't reach your position data right now. Refresh to try again, or ask me a general question.";
    case "network_mismatch":
      return "Your wallet and this app are on different networks, so chat is off until they match.";
    case "loading":
      return "One moment, I'm reading your position.";
  }
}

/** Visible status while a turn runs; `slow` replaces the stage text. */
export function thinkingText(progress: string, slow: boolean): string {
  return slow
    ? "Still thinking… You can wait, or send a new message to replace this one."
    : progress || "Thinking…";
}
