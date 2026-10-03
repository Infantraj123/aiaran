import { ProviderError } from "../core/errors.js";

export interface HttpOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * POST JSON and parse a JSON response. Error messages include the HTTP
 * status and the provider's error type/message (truncated), never the
 * request body.
 */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions & { signal?: AbortSignal } = {},
): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  } catch (error) {
    throw new ProviderError(`${provider} request failed (network error or timeout).`, {
      cause: error,
    });
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : {};
  } catch (error) {
    throw new ProviderError(`${provider} returned a non-JSON response (HTTP ${res.status}).`, {
      status: res.status,
      cause: error,
    });
  }
  if (!res.ok) {
    throw new ProviderError(`${provider} returned HTTP ${res.status}: ${describeError(json)}`, {
      status: res.status,
    });
  }
  return json;
}

function describeError(json: unknown): string {
  const err = (json as { error?: unknown })?.error;
  const message =
    typeof err === "string"
      ? err
      : typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message
        : "request rejected";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

export function requireValue(value: string | undefined, provider: string, what: string): string {
  if (!value) throw new ProviderError(`${provider}: ${what} is required.`);
  return value;
}
