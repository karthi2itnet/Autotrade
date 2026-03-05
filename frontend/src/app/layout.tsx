import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DashboardProvider } from "@/context/DashboardContext";
import Header from "@/components/Header";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Autotrade — Options Bot Dashboard",
  description: "Automated options trading system for NIFTY, BANKNIFTY, FINNIFTY",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} style={{ background: "var(--bg-primary)" }}>
        <DashboardProvider>
          <Header />
          {children}
        </DashboardProvider>
      </body>
    </html>
  );
}
