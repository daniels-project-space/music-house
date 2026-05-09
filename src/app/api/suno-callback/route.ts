// No-op endpoint: Suno V5.5 requires callBackUrl in the generate request.
// We poll for results (see generate-suno-track Trigger task) so the actual
// callback payload is ignored — but the URL must exist or Suno responds
// with 400 "Please enter callBackUrl".
export const runtime = "nodejs";
export async function POST(): Promise<Response> {
  return new Response(null, { status: 204 });
}
export async function GET(): Promise<Response> {
  return new Response("ok", { status: 200 });
}
