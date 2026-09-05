"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/guard", label: "GUARD" },
  { href: "/approvals", label: "APPROVALS" },
  { href: "/telemetry", label: "TELEMETRY" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-[#1e1e1e] bg-[#050505]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center border border-[#2196f3]">
            <span className="h-2 w-2 bg-[#2196f3]" />
          </span>
          <span className="font-display text-2xl tracking-[0.18em] text-[#f2ede6]">ZENGAWD</span>
          <span className="hidden font-mono text-[10px] tracking-widest text-[#5a5a5a] md:inline">ONCHAIN TRANSACTION GUARD</span>
        </Link>
        <nav className="flex items-center gap-6">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`font-mono text-[11px] tracking-[0.18em] transition-colors ${path?.startsWith(l.href) ? "text-[#2196f3]" : "text-[#8a8a8a] hover:text-[#f2ede6]"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
