import { Player } from "@/components/player";
import { Sidebar } from "@/components/sidebar";

// Layout for the internal music-house app routes (library, studio, etc.).
// /share routes live OUTSIDE this group and inherit only the slim root layout.
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
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
