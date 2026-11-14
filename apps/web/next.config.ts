import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@mrfund/agent",
    "@mrfund/engine",
    "@mrfund/guardian-client",
    "@mrfund/rhea",
    "@mrfund/server",
    "@mrfund/shared",
  ],
};

export default config;
