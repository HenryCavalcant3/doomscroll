export interface AiTestResult {
  model: string;
  response: string;
  durationMs: number;
}

/** Envia um prompt ao endpoint de teste da api (via proxy em /api). */
export async function askModel(prompt: string, fetchImpl: typeof fetch = fetch): Promise<AiTestResult> {
  const res = await fetchImpl("/api/ai/teste", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = (await res.json()) as AiTestResult & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error ?? data.message ?? `Erro ${res.status}`);
  return data;
}
