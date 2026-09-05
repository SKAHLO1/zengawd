import React from "react";
import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-barlow-condensed" });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-ibm-plex-mono" });

export const metadata: Metadata = {
  title: "Zengawd",
  description: "Onchain transaction guard: multi-intent risk verdicts routed through Telegraph Protocol, enforced onchain.",
};

export const viewport: Viewport = { themeColor: "#050505" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} min-h-screen bg-[#050505] font-sans text-[#f2ede6] antialiased`}>
        <Nav />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-6 py-10 font-mono text-[10px] tracking-widest text-[#5a5a5a]">
          ZENGAWD · INTENT-DECLARED ROUTING VIA TELEGRAPH PROTOCOL · SETTLED PER CALL WITH x402 ON BASE SEPOLIA
        </footer>
      </body>
    </html>
  );
}
