import type { ReactNode } from "react";

export const metadata = {
  title: "Mr.Fund",
  description: "The DeFi manager you can talk to.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0 bg-[#0c0c10]">{children}</body>
    </html>
  );
}
