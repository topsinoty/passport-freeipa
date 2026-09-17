# @topsinoty/passport-freeipa

[![CI](https://github.com/topsinoty/passport-freeipa/actions/workflows/ci.yml/badge.svg)](https://github.com/topsinoty/passport-freeipa/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@topsinoty/passport-freeipa.svg)](https://www.npmjs.com/package/@topsinoty/passport-freeipa)
[![license](https://img.shields.io/npm/l/@topsinoty/passport-freeipa.svg)](./LICENSE)

[Passport](https://www.passportjs.org/) strategy for authenticating a username
and password against [FreeIPA](https://www.freeipa.org/).

Written in TypeScript, ships ESM and CommonJS, and talks to FreeIPA's session
API over `fetch` with no transitive HTTP stack. One runtime dependency, and
the published type declarations import nothing external.

## Install

```bash
npm i @topsinoty/passport-freeipa passport
```

Requires Node 20 or newer.

## Usage

```ts
import passport from "passport";
import { FreeipaStrategy } from "@topsinoty/passport-freeipa";

passport.use(new FreeipaStrategy({ freeipa: { server: "ipa.example.com" } }));

app.post(
  "/login",
  passport.authenticate("freeipa", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect("/");
  },
);
```

Without a verify callback, the FreeIPA directory entry becomes `req.user`.

### Mapping entries onto your own users

FreeIPA is backed by LDAP, so attributes arrive as arrays. `firstValue` and
`allValues` read them without type assertions.

```ts
import { FreeipaStrategy, firstValue } from "@topsinoty/passport-freeipa";

passport.use(
  new FreeipaStrategy(
    { freeipa: { server: "ipa.example.com" } },
    (entry, done) => {
      const uid = firstValue(entry, "uid");
      if (uid === null) {
        done(null, false, { message: "Entry has no uid." });
        return;
      }

      User.findOrCreate({ uid }).then((user) => {
        done(null, user);
      }, done);
    },
  ),
);
```

Call `done(null, false, info)` to reject a user FreeIPA accepted — for example
one outside a required group:

```ts
import { allValues } from "@topsinoty/passport-freeipa";

(entry, done) => {
  if (!allValues(entry, "memberof_group").includes("staff")) {
    done(null, false, { message: "Staff only." });
    return;
  }
  done(null, entry);
};
```

### Access to the request

Set `passReqToCallback: true` and the callback takes `(request, user, done)`.
Pass your framework's request type as the strategy's type parameter to get it
fully typed:

```ts
import type { Request } from "express";

passport.use(
  new FreeipaStrategy<Request>(
    { freeipa: { server: "ipa.example.com" }, passReqToCallback: true },
    (request, user, done) => {
      request.session.lastLogin = Date.now();
      done(null, user);
    },
  ),
);
```

`passReqToCallback: true` with a two-argument callback is a compile error, not
a runtime surprise.

## Options

### Strategy options

| Option              | Type             | Default      | Description                                                         |
| ------------------- | ---------------- | ------------ | ------------------------------------------------------------------- |
| `freeipa`           | `FreeipaOptions` | —            | Required. Connection settings, below.                               |
| `usernameField`     | `string`         | `"username"` | Field holding the username. Supports bracket paths: `"user[name]"`. |
| `passwordField`     | `string`         | `"password"` | Field holding the password.                                         |
| `passReqToCallback` | `boolean`        | `false`      | Pass the request as the verify callback's first argument.           |

Credentials are read from the parsed body first, then the query string. Only
string values are accepted, so a JSON body such as `{"password": {"$ne": null}}`
is rejected rather than coerced.

### FreeIPA options

| Option          | Type           | Default            | Description                                                         |
| --------------- | -------------- | ------------------ | ------------------------------------------------------------------- |
| `server`        | `string`       | —                  | Required. Hostname or origin. A bare hostname is upgraded to HTTPS. |
| `clientVersion` | `string`       | `"2.156"`          | API version sent with each call. Pin it for an older server.        |
| `timeout`       | `number`       | `10000`            | Milliseconds before a request is aborted.                           |
| `fetch`         | `typeof fetch` | `globalThis.fetch` | Custom `fetch`, for an internal CA or for tests.                    |

#### Self-signed certificates

FreeIPA deployments usually present a certificate from their own CA. Supply a
`fetch` backed by an `undici` dispatcher that trusts it:

Install `undici` alongside this package, then:

```ts
import { Agent } from "undici";
import { readFileSync } from "node:fs";

const agent = new Agent({
  connect: { ca: readFileSync("/etc/ipa/ca.crt", "utf8") },
});

passport.use(
  new FreeipaStrategy({
    freeipa: {
      server: "ipa.example.com",
      fetch: (input, init) => fetch(input, { ...init, dispatcher: agent }),
    },
  }),
);
```

### Per-request options

`passport.authenticate("freeipa", { badRequestMessage })` overrides the
challenge returned when a request carries no credentials.

## Failure handling

The strategy distinguishes a rejected credential from a broken deployment, so
a wrong password reaches your failure handler instead of your error handler.

| Situation                                  | Outcome   | HTTP  |
| ------------------------------------------ | --------- | ----- |
| Missing or non-string credentials          | `fail()`  | `400` |
| FreeIPA rejected the credentials           | `fail()`  | `401` |
| Verify callback returned `false`           | `fail()`  | `401` |
| Server unreachable — DNS, TLS, timeout     | `error()` | `500` |
| Server answered outside the protocol       | `error()` | `500` |
| Verify callback reported an error or threw | `error()` | `500` |

Failure challenges carry FreeIPA's own reason, read from the
`X-IPA-Rejection-Reason` header:

```ts
passport.authenticate("freeipa", (error, user, info) => {
  if (!user) {
    // info.reason  -> "invalid-password" | "password-expired" |
    //                 "krbprincipal-expired" | "denied" | "unknown"
    // info.message -> a message safe to show the user
  }
});
```

Unrecognised reasons collapse to `unknown` with a generic message, so a future
FreeIPA release cannot leak an unexpected string to a login form.

### Errors

Internal failures are `FreeipaError`, carrying a `code`:

| Code             | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `AUTH_FAILED`    | Credentials refused. Reported as `fail()`, not `error()`. |
| `REQUEST_FAILED` | Server unreachable: DNS, TLS, timeout, connection reset.  |
| `PROTOCOL_ERROR` | Server answered outside the protocol.                     |
| `RPC_ERROR`      | JSON-RPC call returned an error.                          |

## Using the client directly

The FreeIPA client is exported for use outside Passport:

```ts
import { createFreeipaClient } from "@topsinoty/passport-freeipa";

const client = createFreeipaClient({ server: "ipa.example.com" });
const entry = await client.userShow("jdoe", "hunter2");
```

It logs in afresh on every call; sessions are never shared between users.

## Development

```bash
npm install
npm test              # unit and Passport/Express integration tests
npm run typecheck
npm run lint
npm run test:coverage
npm run verify        # build, smoke-test the bundles, validate the package
```

## Differences from `passport-freeipa` 1.x

This is a rewrite of [`passport-freeipa`](https://www.npmjs.com/package/passport-freeipa)
by Lucas Diedrich. Behaviour intentionally differs:

- **Rejected credentials report `fail()`, not `error()`.** 1.x surfaced a wrong
  password as an internal error, producing a 500 instead of running the failure
  handler. This is the one change that alters existing application behaviour.
- **`node-freeipa` is gone.** FreeIPA is reached with `fetch` directly, so
  `freeipa` options are the ones documented above rather than that package's.
  `client_version` is now `clientVersion`.
- **Named exports.** `import { FreeipaStrategy }` or `Strategy`; both ESM and
  CommonJS expose the same names, so `require()` no longer returns the
  constructor itself.
- **A verify callback signalling failure via a `user.error` property is no
  longer honoured.** Report failure through `done`.
- **The strategy no longer extends `passport-strategy`.** That base class is an
  empty constructor contributing nothing at runtime, and Passport requires only
  `name` and `authenticate`. Dropping it removes a dependency and keeps the
  published declarations free of untyped imports, since `passport-strategy`
  ships none and `@types/passport-strategy` declares its class without
  exporting it. `strategy instanceof passport.Strategy` is therefore `false`;
  Passport itself never performs that check.

## Credits

- [O. Promise Temitope](https://github.com/topsinoty)

- [Lucas Diedrich](https://github.com/lucasdiedrich) — original `passport-freeipa`.

This project structure is also based over:

- [Passport Local](https://github.com/jaredhanson/passport-local)
- [Passport LDAP](https://github.com/vesse/passport-ldapauth)

## License

[The MIT License](http://opensource.org/licenses/MIT)
