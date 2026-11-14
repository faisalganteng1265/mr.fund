import type { ReactNode } from "react";
import { WalletProvider } from "../../wallet/react";

/** Wallet SDKs load only on the consultation route, never on the landing page. */
export default function PlayLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
