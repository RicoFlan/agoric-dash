import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agoric L1 activity",
  description: "On-chain activity dashboard for Agoric mainnet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
