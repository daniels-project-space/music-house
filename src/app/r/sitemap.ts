/**
 * Sitemap for the public funnel pages -> /r/sitemap.xml.
 *
 * Lists every release that is live on stores (has resolved storeLinks), so Google
 * discovers each /r/{artist}/{album} page. Released-state is keyed on storeLinks,
 * not the `distributed` flag, to match the funnel page's own publish condition.
 */
import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

export const dynamic = "force-dynamic";

const LISTEN_BASE = (
  process.env.NEXT_PUBLIC_LISTEN_BASE_URL ?? "https://mh-listen.vercel.app"
).replace(/\/+$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return [];
  const convex = new ConvexHttpClient(url);

  let released: { artistSlug: string; slug: string; updatedAt: number }[] = [];
  try {
    released = await convex.query(api.albums.listReleased, {});
  } catch {
    return [];
  }

  return released.map((r) => ({
    url: `${LISTEN_BASE}/r/${r.artistSlug}/${r.slug}`,
    lastModified: new Date(r.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));
}
