"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Player } from "./player";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isPublic = pathname.startsWith("/share");
  if (isPublic) {
    return <>{children}</>;
  }
  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
      <Player />
    </>
  );
}
