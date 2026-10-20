const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api/v1`;

export type ApiError = { error: { code: string; message: string; trace_id: string } };

export async function api<T>(path: string, init: RequestInit & { role?: string } = {}): Promise<T> {
  const { role, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(role ? { "X-Role": role } : {}),
      ...headers,
    },
  });
  const body = await res.json();
  if (!res.ok) throw body as ApiError;
  return body as T;
}
