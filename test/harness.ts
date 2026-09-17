/**
 * Test helpers: a fake FreeIPA server and a Passport outcome recorder.
 *
 * Every test drives the real strategy through its real `authenticate()`
 * method; only the network and Passport's own plumbing are substituted.
 */

import { FreeipaStrategy } from "../src/strategy";
import type {
  BaseStrategyOptions,
  PassportRequest,
  VerifyCallback,
  VerifyCallbackWithRequest,
} from "../src/types";

/** Arguments the global `fetch` is called with. */
type FetchArgs = Parameters<typeof globalThis.fetch>;

/** Renders a `fetch` input as its URL string. */
const urlOf = (input: FetchArgs[0]): string => {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

/** The outcome a strategy reported for one request. */
export type Outcome =
  | { type: "success"; user: unknown; info: unknown }
  | { type: "fail"; challenge: unknown; status: number }
  | { type: "error"; error: Error };

/** A canned HTTP response for the fake server to return. */
export interface StubResponse {
  status?: number;
  headers?: Record<string, string>;
  /** Repeated `set-cookie` headers, which `Headers` cannot express as a map. */
  cookies?: string[];
  body?: string;
}

/** A network-level failure (DNS, TLS, timeout), as opposed to an HTTP response. */
export interface StubFailure {
  /** The error `fetch` rejects with. */
  throws: Error;
}

/** A network-level failure, as `fetch` reports one. */
export const networkFailure = (message = "fetch failed"): StubFailure => ({
  throws: new TypeError(message),
});

/** A recorded outgoing request. */
export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A `fetch` stub that records what it was called with. */
export type FetchStub = typeof globalThis.fetch & {
  readonly calls: RecordedRequest[];
};

/**
 * Build a `fetch` stub that replies with `responses` in order.
 *
 * Pass a {@link networkFailure} in place of a response to simulate the server
 * being unreachable.
 */
export const stubFetch = (
  ...responses: (StubResponse | StubFailure)[]
): FetchStub => {
  const calls: RecordedRequest[] = [];
  let index = 0;

  const fetchStub = async (...[input, init]: FetchArgs): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: urlOf(input),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses[index];
    index += 1;

    if (next === undefined) {
      throw new Error(
        `stubFetch: unexpected request ${String(index)} to ${urlOf(input)}`,
      );
    }
    if ("throws" in next) {
      throw next.throws;
    }

    const responseHeaders = new Headers(next.headers);
    for (const cookie of next.cookies ?? []) {
      responseHeaders.append("set-cookie", cookie);
    }

    return new Response(next.body ?? "", {
      status: next.status ?? 200,
      headers: responseHeaders,
    });
  };

  return Object.assign(fetchStub, { calls });
};

/** A successful `login_password` response carrying a session cookie. */
export const loginOk: StubResponse = {
  status: 200,
  cookies: ["ipa_session=abc123; Path=/ipa; Secure; HttpOnly"],
};

/** The directory entry `userShowOk` returns when given no attributes. */
const DEFAULT_ENTRY: Record<string, unknown> = Object.freeze({ uid: ["jdoe"] });

/** A successful `user_show` response for the given attributes. */
export const userShowOk = (
  result: Record<string, unknown> = DEFAULT_ENTRY,
): StubResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ result: { count: 1, result }, error: null }),
});

/**
 * Run a strategy against a request and resolve with the outcome it reported.
 *
 * Rejects if the strategy reports nothing, so a hung flow fails the test
 * instead of timing out silently.
 */
export const authenticate = (
  strategy: FreeipaStrategy,
  request: PassportRequest,
  options?: Record<string, unknown>,
): Promise<Outcome> =>
  new Promise<Outcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("strategy reported no outcome"));
    }, 2000);

    const settle = (outcome: Outcome): void => {
      clearTimeout(timer);
      resolve(outcome);
    };

    Object.assign(strategy, {
      success: (user: unknown, info?: unknown) => {
        settle({ type: "success", user, info });
      },
      fail: (challenge: unknown, status: number) => {
        settle({ type: "fail", challenge, status });
      },
      error: (error: Error) => {
        settle({ type: "error", error });
      },
    });

    strategy.authenticate(request, options ?? {});
  });

/** Options accepted by the harness builders, minus the FreeIPA connection. */
type HarnessOptions = Omit<BaseStrategyOptions, "freeipa">;

/** Construct a strategy wired to a stub `fetch`. */
export const buildStrategy = (
  fetchStub: FetchStub,
  options?: HarnessOptions,
  verify?: VerifyCallback,
): FreeipaStrategy => {
  const full = {
    ...options,
    freeipa: { server: "ipa.example.test", fetch: fetchStub },
  };

  return verify ? new FreeipaStrategy(full, verify) : new FreeipaStrategy(full);
};

/** Construct a strategy whose verify callback also receives the request. */
export const buildStrategyWithRequest = (
  fetchStub: FetchStub,
  verify: VerifyCallbackWithRequest,
  options?: HarnessOptions,
): FreeipaStrategy =>
  new FreeipaStrategy(
    {
      ...options,
      passReqToCallback: true,
      freeipa: { server: "ipa.example.test", fetch: fetchStub },
    },
    verify,
  );

/** Credentials the stubbed server is set up to accept. */
export const credentials = { username: "jdoe", password: "hunter2" };

/** Responses for a login that succeeds and returns `entry`. */
export const serverAccepts = (
  entry?: Record<string, unknown>,
): StubResponse[] => [loginOk, userShowOk(entry)];

/**
 * Drive one authentication attempt with {@link credentials} against a server
 * that replies with `responses`.
 *
 * Covers the common shape; tests that need custom fields, a custom request,
 * or access to the recorded calls compose {@link stubFetch},
 * {@link buildStrategy} and {@link authenticate} directly.
 */
export const attempt = (
  responses: (StubResponse | StubFailure)[],
  verify?: VerifyCallback,
): Promise<Outcome> =>
  authenticate(buildStrategy(stubFetch(...responses), {}, verify), {
    body: credentials,
  });
