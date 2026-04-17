import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(
    /\/+$/,
    "",
  );
}

export async function GET(_req: NextRequest) {
  const url = `${baseUrl()}/api/tags`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return Response.json(
        { models: [], error: `Ollama responded ${res.status}` },
        { status: 200 },
      );
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n) => typeof n === "string" && n.length > 0)
      .sort();
    return Response.json({ models, baseUrl: baseUrl() });
  } catch (e) {
    return Response.json(
      {
        models: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 200 },
    );
  }
}
