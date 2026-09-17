/**
 * End-to-end integration with Passport and Express.
 *
 * The other suites drive the strategy directly. These tests instead register
 * it with a real `passport` instance inside a real Express app, so the things
 * a unit test cannot check are covered:
 *
 * - `passport.use(new FreeipaStrategy(...))` type-checks and is accepted.
 * - Passport attaches `success`/`fail`/`error` and the strategy calls them.
 * - A successful login populates `req.user`.
 * - A rejected credential reaches Passport's failure path (401) rather than
 *   its error handler (500).
 *
 * Only the FreeIPA server is faked; everything else is the real thing.
 */

import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import passport from "passport";
import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { FreeipaStrategy, firstValue } from "../src/index";
import type { VerifyCallback } from "../src/types";
import {
  loginOk,
  networkFailure,
  stubFetch,
  userShowOk,
  type FetchStub,
} from "./harness";

/**
 * Register the strategy against a stubbed FreeIPA server, optionally with a
 * verify callback.
 */
const useStrategy = (
  fetchStub: FetchStub,
  verify?: VerifyCallback,
): void => {
  const options = {
    freeipa: { server: "ipa.example.test", fetch: fetchStub },
  };

  passport.unuse("freeipa");
  passport.use(
    verify
      ? new FreeipaStrategy(options, verify)
      : new FreeipaStrategy(options),
  );
};

/** Build an Express app exposing `POST /login`. */
const buildApp = (route: (app: Express) => void): Express => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(passport.initialize());
  route(app);
  return app;
};

/** What a request to the test server came back with. */
interface LoginResult {
  status: number;
  body: string;
}

describe("integration with passport and express", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running) {
      await new Promise<void>((resolve, reject) => {
        running.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  /** Start `app` on an ephemeral port and POST credentials to `/login`. */
  const login = async (
    app: Express,
    credentials: Record<string, string>,
  ): Promise<LoginResult> => {
    const running = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => {
        resolve(listening);
      });
    });
    server = running;

    const address = running.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the test server to listen on a TCP port");
    }
    const { port } = address;
    const response = await fetch(`http://127.0.0.1:${String(port)}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(credentials).toString(),
    });

    return { status: response.status, body: await response.text() };
  };

  /**
   * The plain `passport.authenticate("freeipa")` form, echoing `req.user`.
   */
  const app = (): Express =>
    buildApp((instance) => {
      instance.post(
        "/login",
        passport.authenticate("freeipa", { session: false }),
        (request: Request, response: Response) => {
          response.json(request.user ?? null);
        },
      );
    });

  describe("as route middleware", () => {
    it("populates req.user with the FreeIPA entry", async () => {
      useStrategy(stubFetch(loginOk, userShowOk({ uid: ["jdoe"] })));

      const result = await login(app(), {
        username: "jdoe",
        password: "hunter2",
      });

      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ uid: ["jdoe"] });
    });

    it("answers 401 when FreeIPA rejects the password", async () => {
      useStrategy(stubFetch({ status: 401 }));

      const result = await login(app(), {
        username: "jdoe",
        password: "wrong",
      });

      expect(result.status).toBe(401);
    });

    it("answers 400 when credentials are missing", async () => {
      useStrategy(stubFetch());

      const result = await login(app(), {});

      expect(result.status).toBe(400);
    });

    it("answers 500 when the FreeIPA server is unreachable", async () => {
      useStrategy(stubFetch(networkFailure()));

      const result = await login(app(), { username: "jdoe", password: "pw" });

      expect(result.status).toBe(500);
    });
  });

  describe("with a custom callback", () => {
    /**
     * The `passport.authenticate(name, callback)` form, which surfaces the
     * exact `(error, user, info)` triple the strategy reported.
     */
    const app = (): Express =>
      buildApp((instance) => {
        instance.post("/login", (request, response, next) => {
          passport.authenticate(
            "freeipa",
            { session: false },
            (error: unknown, user: unknown, info: unknown) => {
              if (error) {
                next(error);
                return;
              }
              response.status(user ? 200 : 401).json({
                user: user ?? null,
                info: info ?? null,
              });
            },
          )(request, response, next);
        });
      });

    it("reports the entry on success", async () => {
      useStrategy(stubFetch(loginOk, userShowOk({ uid: ["jdoe"] })));

      const result = await login(app(), { username: "jdoe", password: "pw" });

      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        user: { uid: ["jdoe"] },
      });
    });

    it("reports info, not an error, for an expired password", async () => {
      useStrategy(
        stubFetch({
          status: 401,
          headers: { "x-ipa-rejection-reason": "password-expired" },
        }),
      );

      const result = await login(app(), { username: "jdoe", password: "old" });

      expect(result.status).toBe(401);
      expect(JSON.parse(result.body).info).toMatchObject({
        reason: "password-expired",
        message: "Password expired. Please reset your password.",
      });
    });
  });

  describe("with a verify callback", () => {
    it("maps the FreeIPA entry onto an application user", async () => {
      useStrategy(
        stubFetch(loginOk, userShowOk({ uid: ["jdoe"], mail: ["jdoe@example.test"] })),
        (entry, done) => {
          done(null, {
            id: firstValue(entry, "uid"),
            email: firstValue(entry, "mail"),
          });
        },
      );

      const result = await login(app(), { username: "jdoe", password: "pw" });

      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        id: "jdoe",
        email: "jdoe@example.test",
      });
    });

    it("rejects a user the application does not admit", async () => {
      useStrategy(
        stubFetch(loginOk, userShowOk({ uid: ["contractor"] })),
        (_entry, done) => {
          done(null, false, { message: "Staff only." });
        },
      );

      const result = await login(app(), {
        username: "contractor",
        password: "pw",
      });

      expect(result.status).toBe(401);
    });
  });

  describe("passReqToCallback", () => {
    it("gives the verify callback the Express request, fully typed", async () => {
      let seenPath: string | undefined;

      passport.unuse("freeipa");
      passport.use(
        new FreeipaStrategy<Request>(
          {
            passReqToCallback: true,
            freeipa: {
              server: "ipa.example.test",
              fetch: stubFetch(loginOk, userShowOk()),
            },
          },
          (request, user, done) => {
            seenPath = request.path;
            done(null, user);
          },
        ),
      );

      const result = await login(app(), { username: "jdoe", password: "pw" });

      expect(result.status).toBe(200);
      expect(seenPath).toBe("/login");
    });
  });
});
