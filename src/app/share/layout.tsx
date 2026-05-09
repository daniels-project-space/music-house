"use client";
import { useEffect } from "react";

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add("share-mode");
    return () => document.body.classList.remove("share-mode");
  }, []);
  return <>{children}</>;
}
