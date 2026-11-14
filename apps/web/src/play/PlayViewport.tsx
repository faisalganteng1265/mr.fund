"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useWalletSession } from "../wallet/react";
import { createDemoSource } from "./source/demoSource";
import { createLiveSessionPort, withLiveSession } from "./source/liveSession";

const Playground = dynamic(() => import("./Playground").then((module) => module.Playground), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="fixed inset-0 grid min-h-dvh place-items-center bg-[#0c0e0f] font-[family-name:var(--font-body)] text-sm text-[#edf3f5]"
    >
      Opening the office…
    </div>
  ),
});

/** The demo works in portrait and landscape; the room reframes itself to the space the HUD leaves. */
export function PlayViewport({ source }: { source: "demo" }) {
  const [consultationSource] = useState(() => {
    switch (source) {
      case "demo":
        return createDemoSource();
    }
  });
  const wallet = useWalletSession();
  const { controller, network } = wallet;
  const liveSource = useMemo(
    () =>
      controller && network
        ? withLiveSession(
            consultationSource,
            createLiveSessionPort(controller, () => controller.logout(), network),
          )
        : null,
    [consultationSource, controller, network],
  );
  // A real account is used only once the provider reports it; otherwise the labelled demo runs.
  const active =
    liveSource && wallet.state.status === "connected" ? liveSource : consultationSource;
  return <Playground source={active} wallet={wallet} />;
}
