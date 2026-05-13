import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcCallWithFallback } from "@/lib/rpc";

type FetchInit = { method?: string; body?: string };
type FetchHandler = (url: string, init: FetchInit) => Response | Promise<Response>;

function installFetchSequence(handlers: FetchHandler[]): Array<{ url: string; init: FetchInit }> {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  let i = 0;
  vi.stubGlobal("fetch", (async (input: string, init?: FetchInit) => {
    const handler = handlers[i++];
    calls.push({ url: input, init: init ?? {} });
    if (!handler) throw new Error(`unexpected extra fetch call to ${input}`);
    return handler(input, init ?? {});
  }) as unknown as typeof fetch);
  return calls;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("rpcCallWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when no URLs are provided", async () => {
    await expect(rpcCallWithFallback([], "status", {})).rejects.toThrow(/at least one/);
  });

  it("treats empty / non-string URLs as absent and surfaces a config error", async () => {
    await expect(rpcCallWithFallback(["", ""], "status", {})).rejects.toThrow(/at least one/);
  });

  it("returns first-URL result and never queries the fallback", async () => {
    const calls = installFetchSequence([() => jsonResponse({ result: { hello: "primary" } })]);
    const r = await rpcCallWithFallback<{ hello: string }>(
      ["https://primary", "https://backup"],
      "status",
      {}
    );
    expect(r.hello).toBe("primary");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://primary");
  });

  it("falls back when the first URL returns a non-OK HTTP status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = installFetchSequence([
      () => new Response("upstream broke", { status: 502 }),
      () => jsonResponse({ result: { hello: "backup" } }),
    ]);
    const r = await rpcCallWithFallback<{ hello: string }>(
      ["https://primary", "https://backup"],
      "status",
      {}
    );
    expect(r.hello).toBe("backup");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe("https://backup");
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0]);
    expect(msg).toContain("https://primary");
    expect(msg).toContain("https://backup");
    expect(msg).toContain("status");
    expect(msg).toContain("RPC HTTP 502");
  });

  it("falls back when the first URL returns a JSON-RPC error body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchSequence([
      () => jsonResponse({ error: { message: "node behind" } }),
      () => jsonResponse({ result: 42 }),
    ]);
    const r = await rpcCallWithFallback<number>(
      ["https://primary", "https://backup"],
      "status",
      {}
    );
    expect(r).toBe(42);
  });

  it("falls back when fetch itself rejects (network-level failure)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchSequence([
      () => {
        throw new TypeError("network unreachable");
      },
      () => jsonResponse({ result: "ok" }),
    ]);
    const r = await rpcCallWithFallback<string>(
      ["https://primary", "https://backup"],
      "status",
      {}
    );
    expect(r).toBe("ok");
  });

  it("throws the last error when all URLs fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchSequence([
      () => new Response("a", { status: 500 }),
      () => new Response("b", { status: 503 }),
    ]);
    await expect(
      rpcCallWithFallback(["https://primary", "https://backup"], "status", {})
    ).rejects.toThrow(/HTTP 503/);
  });

  it("deduplicates URLs (does not double-bill the same endpoint)", async () => {
    const calls = installFetchSequence([() => jsonResponse({ result: 1 })]);
    await rpcCallWithFallback(["https://primary", "https://primary"], "status", {});
    expect(calls).toHaveLength(1);
  });

  it("does not warn on success without fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchSequence([() => jsonResponse({ result: 1 })]);
    await rpcCallWithFallback(["https://primary"], "status", {});
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when the final URL fails (last failure is thrown, not warned)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchSequence([() => new Response("x", { status: 500 })]);
    await expect(
      rpcCallWithFallback(["https://only"], "status", {})
    ).rejects.toThrow(/HTTP 500/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("forwards method and params to fetch body", async () => {
    const calls = installFetchSequence([() => jsonResponse({ result: 1 })]);
    await rpcCallWithFallback(["https://primary"], "block", { height: "42" });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.method).toBe("block");
    expect(body.params).toEqual({ height: "42" });
  });
});
