// The API has no public face: anything that is not an /api route looks like nothing is here.
export function GET() {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
}
