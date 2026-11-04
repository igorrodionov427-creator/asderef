"use client";

import { LayoutDashboard, ListOrdered, LogOut, Plus, Settings, FlaskConical } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Gate } from "./Gate";
import { useAuth } from "./Providers";
import { Logo } from "./ui";

const NAV = [
  { href: "/dashboard/", label: "Overview", icon: LayoutDashboard },
  { href: "/payments/", label: "Payments", icon: ListOrdered },
  { href: "/new/", label: "New payment", icon: Plus },
  { href: "/settings/", label: "Settings", icon: Settings },
];

/** Authenticated app frame: sidebar on desktop, tab bar on phones. */
export function Shell({ children }: { children: React.ReactNode }) {
  const { auth, logout } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === "ready") document.title = "Agency Pay";
  }, [auth.status, pathname]);

  if (auth.status === "checking") return <div className="min-h-dvh bg-bg" />;
  if (auth.status === "locked") return <Gate />;

  const active = (href: string) => pathname === href || pathname.startsWith(href) || (href === "/payments/" && pathname.startsWith("/projects"));
  const testMode = auth.config.livemode === false;

  return (
    <div className="glow min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-bg/80 px-3 py-5 backdrop-blur md:flex">
        <Link href="/dashboard/" className="mb-8 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Agency Pay</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active(href) ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
        {testMode && <TestBadge />}
        <button onClick={logout} className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-faint hover:bg-surface hover:text-ink">
          <LogOut size={17} strokeWidth={1.8} /> Sign out
        </button>
      </aside>

      {/* Mobile top bar */}
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/dashboard/" className="flex items-center gap-2">
            <Logo size={26} />
            <span className="text-[15px] font-semibold tracking-tight">Agency Pay</span>
          </Link>
          {testMode && <span className="rounded-full bg-warn/15 px-2.5 py-1 text-[11px] font-medium text-warn">TEST MODE</span>}
        </div>
      </header>

      <main className="pb-nav mx-auto w-full max-w-6xl px-4 pt-5 md:pb-12 md:pl-64 md:pr-8 md:pt-8 lg:pl-68">
        {children}
      </main>

      {/* Mobile tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid h-[68px] max-w-md grid-cols-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            const isNew = href === "/new/";
            return (
              <Link key={href} href={href} className="flex flex-col items-center justify-center gap-1">
                {isNew ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_8px_20px_-6px_rgba(122,104,255,0.7)]">
                    <Icon size={22} strokeWidth={2.2} />
                  </span>
                ) : (
                  <Icon size={22} strokeWidth={on ? 2.2 : 1.7} className={on ? "text-ink" : "text-faint"} />
                )}
                <span className={`text-[10.5px] ${on ? "text-ink" : "text-faint"}`}>{isNew ? "New" : label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function TestBadge() {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-warn/20 bg-warn/10 px-3 py-2.5 text-xs text-warn">
      <FlaskConical size={14} className="mt-0.5 shrink-0" />
      <span>Test mode — payments are simulated by 1Pay, no money moves.</span>
    </div>
  );
}
