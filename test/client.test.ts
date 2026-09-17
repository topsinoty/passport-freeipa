import { describe, expect, it } from "vitest";
import { allValues, createFreeipaClient, firstValue } from "../src/client";
import { FreeipaError } from "../src/errors";
import { loginOk, networkFailure, stubFetch, userShowOk } from "./harness";

const client = (
  fetchStub: typeof globalThis.fetch,
  server = "ipa.example.test",
) => createFreeipaClient({ server, fetch: fetchStub });

describe("createFreeipaClient", () => {
  describe("request shape", () => {
    it("logs in, then calls user_show with the session cookie", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await client(fetchStub).userShow("jdoe", "hunter2");

      const [login, rpc] = fetchStub.calls;
      expect(login?.url).toBe(
        "https://ipa.example.test/ipa/session/login_password",
      );
      expect(login?.body).toBe("user=jdoe&password=hunter2");
      expect(login?.headers["content-type"]).toBe(
        "application/x-www-form-urlencoded",
      );

      expect(rpc?.url).toBe("https://ipa.example.test/ipa/session/json");
      expect(rpc?.headers.cookie).toBe("ipa_session=abc123");
      expect(JSON.parse(rpc?.body ?? "")).toMatchObject({
        method: "user_show",
        params: [["jdoe"], { version: "2.156" }],
      });
    });

    it("sends the Referer header FreeIPA's CSRF check requires", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await client(fetchStub).userShow("jdoe", "hunter2");

      expect(fetchStub.calls[0]?.headers.referer).toBe(
        "https://ipa.example.test/ipa",
      );
    });

    it("upgrades a bare hostname to https", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await client(fetchStub, "ipa.example.test").userShow("jdoe", "pw");

      expect(fetchStub.calls[0]?.url.startsWith("https://")).toBe(true);
    });

    it("honours an explicit scheme and port", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await client(fetchStub, "https://ipa.example.test:8443").userShow(
        "j",
        "p",
      );

      expect(fetchStub.calls[0]?.url).toBe(
        "https://ipa.example.test:8443/ipa/session/login_password",
      );
    });

    it("does not let a path on the server URL displace the endpoint", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await client(fetchStub, "https://ipa.example.test/some/path").userShow(
        "j",
        "p",
      );

      expect(fetchStub.calls[0]?.url).toBe(
        "https://ipa.example.test/ipa/session/login_password",
      );
    });

    it("honours a configured client version", async () => {
      const fetchStub = stubFetch(loginOk, userShowOk());
      await createFreeipaClient({
        server: "ipa.example.test",
        fetch: fetchStub,
        clientVersion: "2.100",
      }).userShow("jdoe", "pw");

      expect(JSON.parse(fetchStub.calls[1]?.body ?? "")).toMatchObject({
        params: [["jdoe"], { version: "2.100" }],
      });
    });
  });

  describe("success", () => {
    it("returns the directory entry", async () => {
      const entry = { uid: ["jdoe"], mail: ["jdoe@example.test"] };
      const fetchStub = stubFetch(loginOk, userShowOk(entry));

      await expect(client(fetchStub).userShow("jdoe", "pw")).resolves.toEqual(
        entry,
      );
    });

    it("picks the session cookie out by name, not by position", async () => {
      const fetchStub = stubFetch(
        {
          status: 200,
          cookies: [
            "ipa_other=xyz; Path=/",
            "ipa_session=abc123; Path=/ipa; Secure",
          ],
        },
        userShowOk(),
      );
      await client(fetchStub).userShow("jdoe", "pw");

      expect(fetchStub.calls[1]?.headers.cookie).toBe("ipa_session=abc123");
    });
  });

  describe("credential rejection", () => {
    it.each([
      {
        case: "a 401 with no reason header",
        header: undefined,
        reason: "unknown",
        message: "Invalid username or password.",
      },
      {
        case: "an expired password",
        header: "password-expired",
        reason: "password-expired",
        message: "Password expired. Please reset your password.",
      },
      {
        case: "an unrecognised reason, collapsed to generic",
        header: "something-new",
        reason: "unknown",
        message: "Invalid username or password.",
      },
    ])("maps $case to AUTH_FAILED", async ({ header, reason, message }) => {
      const fetchStub = stubFetch({
        status: 401,
        ...(header ? { headers: { "x-ipa-rejection-reason": header } } : {}),
      });

      await expect(client(fetchStub).userShow("jdoe", "pw")).rejects.toMatchObject(
        { name: "FreeipaError", code: "AUTH_FAILED", reason, message },
      );
    });

    it("treats a JSON-RPC ACIError as a credential rejection", async () => {
      const fetchStub = stubFetch(loginOk, {
        status: 200,
        body: JSON.stringify({
          error: { code: 2100, message: "Insufficient access" },
        }),
      });

      await expect(client(fetchStub).userShow("jdoe", "pw")).rejects.toMatchObject(
        { code: "AUTH_FAILED", reason: "denied" },
      );
    });
  });

  describe("server and protocol faults", () => {
    it.each([
      {
        case: "a 5xx from the login endpoint",
        responses: [{ status: 503 }],
        code: "PROTOCOL_ERROR",
      },
      {
        case: "a login that returns no session cookie",
        responses: [{ status: 200 }],
        code: "PROTOCOL_ERROR",
      },
      {
        case: "a non-JSON RPC response",
        responses: [loginOk, { status: 200, body: "<html>502</html>" }],
        code: "PROTOCOL_ERROR",
      },
      {
        case: "a JSON body that is not an object",
        responses: [loginOk, { status: 200, body: "123" }],
        code: "PROTOCOL_ERROR",
      },
      {
        case: "an RPC success carrying no entry",
        responses: [
          loginOk,
          { status: 200, body: JSON.stringify({ result: { count: 0 }, error: null }) },
        ],
        code: "PROTOCOL_ERROR",
      },
      {
        case: "a non-ACI JSON-RPC error",
        responses: [
          loginOk,
          {
            status: 200,
            body: JSON.stringify({
              error: { code: 4001, message: "jdoe: user not found" },
            }),
          },
        ],
        code: "RPC_ERROR",
      },
      {
        case: "a network failure",
        responses: [networkFailure()],
        code: "REQUEST_FAILED",
      },
    ])("reports $code for $case", async ({ responses, code }) => {
      const fetchStub = stubFetch(...responses);

      await expect(client(fetchStub).userShow("jdoe", "pw")).rejects.toMatchObject(
        { code },
      );
    });

    it("names the server in a network failure, without the password", async () => {
      const attempt = (): Promise<unknown> =>
        client(stubFetch(networkFailure())).userShow("jdoe", "hunter2");

      await expect(attempt()).rejects.toBeInstanceOf(FreeipaError);
      await expect(attempt()).rejects.toThrow(/ipa\.example\.test/);
      await expect(attempt()).rejects.not.toThrow(/hunter2/);
    });

    it("rejects an invalid server URL", async () => {
      const fetchStub = stubFetch(loginOk);

      await expect(
        client(fetchStub, "http://[bad").userShow("jdoe", "pw"),
      ).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    });
  });
});

describe("firstValue", () => {
  it("reads the first element of an LDAP-style array", () => {
    expect(firstValue({ uid: ["jdoe", "jdoe2"] }, "uid")).toBe("jdoe");
  });

  it("reads a bare string attribute", () => {
    expect(firstValue({ uid: "jdoe" }, "uid")).toBe("jdoe");
  });

  it("returns null for a missing attribute", () => {
    expect(firstValue({}, "uid")).toBeNull();
  });

  it("returns null when the attribute holds no string", () => {
    expect(firstValue({ nsaccountlock: false }, "nsaccountlock")).toBeNull();
    expect(firstValue({ uid: [] }, "uid")).toBeNull();
    expect(firstValue({ uid: [42] }, "uid")).toBeNull();
  });
});

describe("allValues", () => {
  it("returns every string in a multi-valued attribute", () => {
    const entry = { memberof_group: ["staff", "admins"] };
    expect(allValues(entry, "memberof_group")).toEqual(["staff", "admins"]);
  });

  it("wraps a bare string", () => {
    expect(allValues({ uid: "jdoe" }, "uid")).toEqual(["jdoe"]);
  });

  it("returns an empty array for a missing attribute", () => {
    expect(allValues({}, "memberof_group")).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(allValues({ mixed: ["a", 1, null, "b"] }, "mixed")).toEqual([
      "a",
      "b",
    ]);
  });
});
