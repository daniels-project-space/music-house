/** Engine inputs, receipts and outputs are private even to logged-in catalog callers. */
export function isPublicMediaKey(key: unknown): key is string {
  if (typeof key !== "string" || !key || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key) || key.includes("://") || key.includes("%")) return false;
  const parts = key.split("/");
  return parts.every(part => !!part && part !== "." && part !== "..") && parts[0].toLowerCase() !== "projects";
}
