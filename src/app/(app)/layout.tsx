import { Sidebar } from "@/components/sidebar";

// Layout for the internal music-house app routes (library, studio, etc.).
// /share routes live OUTSIDE this group and inherit only the slim root layout.
// Player lives at root level so audio survives navigation between groups.
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
