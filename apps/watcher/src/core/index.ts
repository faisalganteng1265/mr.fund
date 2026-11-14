// Pure, runtime-agnostic evaluation loop (BUILD-PLAN P5.3). The Node entry owns keys and RPC.
// This package never imports @mrfund/agent (ARCHITECTURE "Import rules").
export const packageName = "@mrfund/watcher" as const;
export * from "./authority";
export * from "./evaluate";
export * from "./loop";
export * from "./types";
