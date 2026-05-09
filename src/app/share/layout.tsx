// Share routes use a clean public layout. The root layout's AppChrome
// detects /share paths and skips Sidebar/Player rendering, so this layout
// just passes children through.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
