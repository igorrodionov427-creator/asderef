"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Gate } from "@/components/Gate";
import { useAuth } from "@/components/Providers";

export default function Home() {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "ready") router.replace("/dashboard/");
  }, [auth.status, router]);

  if (auth.status === "locked") return <Gate />;
  return <div className="min-h-dvh bg-bg" />;
}
