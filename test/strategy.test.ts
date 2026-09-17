import { describe, expect, it, vi } from "vitest";
import { FreeipaStrategy } from "../src/strategy";
import { firstValue } from "../src/client";
import {
  attempt,
  authenticate,
  buildStrategy,
  buildStrategyWithRequest,
  credentials,
  networkFailure,
  serverAccepts,
  stubFetch,
} from "./harness";
import type { VerifyDone } from "../src/types";

const server = { server: "ipa.example.test" };

describe("FreeipaStrategy", () => {
  describe("construction", () => {
    it("registers under the name 'freeipa' with default fields", () => {
      const strategy = new FreeipaStrategy({ freeipa: server });

      expect(strategy.name).toBe("freeipa");
      expect(strategy.usernameField).toBe("username");
      expect(strategy.passwordField).toBe("password");
      expect(strategy.passReqToCallback).toBe(false);
    });

    it("throws when options are omitted", () => {
      // @ts-expect-error -- options are required.
      expect(() => new FreeipaStrategy()).toThrow(TypeError);
    });

    it("throws when freeipa.server is missing", () => {
      // @ts-expect-error -- freeipa.server is required.
      expect(() => new FreeipaStrategy({ freeipa: {} })).toThrow(
        /options\.freeipa\.server is required/,
      );
    });

    it("throws when passReqToCallback is set without a verify callback", () => {
      const options = { freeipa: server, passReqToCallback: true } as const;

      // @ts-expect-error -- passReqToCallback: true requires a (request, user, done) callback.
      expect(() => new FreeipaStrategy(options)).toThrow(/passReqToCallback/);
    });
  });

  describe("action methods", () => {
    it("throw when called outside an authentication attempt", () => {
      const strategy = new FreeipaStrategy({ freeipa: server });

      expect(() => { strategy.success({ uid: ["jdoe"] }); }).toThrow(/Passport/);
      expect(() => { strategy.fail({}, 401); }).toThrow(/Passport/);
      expect(() => { strategy.error(new Error("x")); }).toThrow(/Passport/);
    });

    it("are overridden by an own property, as Passport does", () => {
      const strategy = new FreeipaStrategy({ freeipa: server });
      const seen: unknown[] = [];
      Object.assign(strategy, { success: (user: unknown) => seen.push(user) });

      strategy.success({ uid: ["jdoe"] });

      expect(seen).toEqual([{ uid: ["jdoe"] }]);
    });
  });

  describe("missing credentials", () => {
    it.each([
      { case: "an empty body", body: {} },
      { case: "only a username", body: { username: "jdoe" } },
      { case: "an empty password", body: { username: "jdoe", password: "" } },
      {
        case: "a non-string password",
        body: { username: "jdoe", password: { $ne: null } },
      },
    ])("fails with 400 given $case", async ({ body }) => {
      const fetchStub = stubFetch();

      const outcome = await authenticate(buildStrategy(fetchStub), { body });

      expect(outcome).toMatchObject({ type: "fail", status: 400 });
      expect(fetchStub.calls, "must not reach the server").toHaveLength(0);
    });

    it("uses the default challenge message", async () => {
      const outcome = await authenticate(buildStrategy(stubFetch()), {
        body: {},
      });

      expect(outcome).toMatchObject({
        challenge: { message: "Missing credentials." },
      });
    });

    it("uses a custom badRequestMessage", async () => {
      const outcome = await authenticate(
        buildStrategy(stubFetch()),
        { body: {} },
        { badRequestMessage: "Tell us who you are." },
      );

      expect(outcome).toMatchObject({
        challenge: { message: "Tell us who you are." },
      });
    });
  });

  describe("credential sources", () => {
    it.each([
      { case: "the body", request: { body: credentials } },
      { case: "the query string", request: { body: {}, query: credentials } },
      {
        case: "custom field names",
        request: { body: { email: "jdoe", passwd: "hunter2" } },
        options: { usernameField: "email", passwordField: "passwd" },
      },
      {
        case: "bracket-notation field names",
        request: { body: { user: { name: "jdoe", pass: "hunter2" } } },
        options: { usernameField: "user[name]", passwordField: "user[pass]" },
      },
    ])("reads credentials from $case", async ({ request, options }) => {
      const strategy = buildStrategy(stubFetch(...serverAccepts()), options);

      const outcome = await authenticate(strategy, request);

      expect(outcome).toMatchObject({ type: "success" });
    });

    it("prefers the body over the query string", async () => {
      const fetchStub = stubFetch(...serverAccepts());

      await authenticate(buildStrategy(fetchStub), {
        body: credentials,
        query: { username: "someone-else", password: "other" },
      });

      expect(fetchStub.calls[0]?.body).toContain("user=jdoe");
    });
  });

  describe("without a verify callback", () => {
    it("succeeds with the raw FreeIPA entry", async () => {
      const entry = { uid: ["jdoe"], mail: ["jdoe@example.test"] };

      const outcome = await attempt(serverAccepts(entry));

      expect(outcome).toEqual({ type: "success", user: entry, info: undefined });
    });
  });

  describe("with a verify callback", () => {
    it("receives the entry and maps the returned user", async () => {
      const verify = vi.fn((user: Record<string, unknown>, done: VerifyDone) => {
        done(null, { id: 7, uid: firstValue(user, "uid") }, { scope: "all" });
      });

      const outcome = await attempt(serverAccepts(), verify);

      expect(verify).toHaveBeenCalledOnce();
      expect(outcome).toEqual({
        type: "success",
        user: { id: 7, uid: "jdoe" },
        info: { scope: "all" },
      });
    });

    it("fails when the callback rejects the user", async () => {
      const outcome = await attempt(serverAccepts(), (_user, done) => {
        done(null, false, { message: "Not a member of staff." });
      });

      expect(outcome).toEqual({
        type: "fail",
        challenge: { message: "Not a member of staff." },
        status: 401,
      });
    });

    it("errors when the callback reports an error", async () => {
      const failure = new Error("database down");

      const outcome = await attempt(serverAccepts(), (_user, done) => {
        done(failure);
      });

      expect(outcome).toEqual({ type: "error", error: failure });
    });

    it("errors when the callback throws synchronously", async () => {
      const outcome = await attempt(serverAccepts(), () => {
        throw new Error("boom");
      });

      expect(outcome).toMatchObject({ type: "error" });
    });

    it("wraps a non-Error thrown by the callback", async () => {
      const outcome = await attempt(serverAccepts(), () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test
        throw "just a string";
      });

      expect(outcome).toEqual({
        type: "error",
        error: new Error("just a string"),
      });
    });

    it("ignores a second call to done", async () => {
      const outcome = await attempt(serverAccepts(), (user, done) => {
        done(null, user);
        done(new Error("too late"));
      });

      expect(outcome).toMatchObject({ type: "success" });
    });

    it("binds `this` to the strategy, matching Passport convention", async () => {
      let observed: unknown;
      const strategy = buildStrategy(
        stubFetch(...serverAccepts()),
        {},
        function verify(this: unknown, user, done) {
          observed = this;
          done(null, user);
        },
      );

      await authenticate(strategy, { body: credentials });

      expect(observed).toBe(strategy);
    });

    it("receives the request first when passReqToCallback is set", async () => {
      const request = { body: credentials };
      let received: unknown;

      const strategy = buildStrategyWithRequest(
        stubFetch(...serverAccepts()),
        (req, user, done) => {
          received = req;
          done(null, user);
        },
      );

      await authenticate(strategy, request);

      expect(received).toBe(request);
    });
  });

  describe("FreeIPA failures", () => {
    it("fails, rather than errors, on a wrong password", async () => {
      const outcome = await attempt([{ status: 401 }]);

      expect(outcome).toMatchObject({
        type: "fail",
        status: 401,
        challenge: { message: "Invalid username or password." },
      });
    });

    it("surfaces the rejection reason in the challenge", async () => {
      const outcome = await attempt([
        {
          status: 401,
          headers: { "x-ipa-rejection-reason": "password-expired" },
        },
      ]);

      expect(outcome).toMatchObject({
        type: "fail",
        challenge: { reason: "password-expired" },
      });
    });

    it.each([
      { case: "the server is unreachable", responses: [networkFailure()] },
      { case: "the server answers unexpectedly", responses: [{ status: 503 }] },
    ])("errors when $case", async ({ responses }) => {
      const outcome = await attempt(responses);

      expect(outcome).toMatchObject({ type: "error" });
    });

    it("does not leak the password into the reported outcome", async () => {
      const outcome = await attempt([networkFailure()]);

      expect(JSON.stringify(outcome)).not.toContain("hunter2");
    });
  });
});
