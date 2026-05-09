export const runtime = "nodejs";

const COOKIE_NAME = "mh_unlock";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const expected = process.env.MUSIC_HOUSE_UNLOCK;
  if (!expected) {
    return Response.json({ error: "auth not configured" }, { status: 500 });
  }
  if (!body.password || body.password !== expected) {
    return Response.json({ error: "wrong password" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}; Secure`,
  );
  return res;
}
