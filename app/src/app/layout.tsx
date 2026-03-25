import type { Metadata } from "next";
import { Header } from "@/components/header";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "stacky",
  description: "sBTC prediction markets on Stacks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <WalletProvider>
          <Header />
          <main className="pt-11">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
