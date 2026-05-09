import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Listen",
  description: "Public listen page",
  robots: { index: false, follow: false },
};

// Share routes use a clean public layout. The root layout's AppChrome
// detects /share paths and skips Sidebar/Player rendering, so this layout
// just passes children through and overrides the document title/metadata.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
