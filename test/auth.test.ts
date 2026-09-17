import { describe, expect, it } from "vitest";
import { resolveField } from "../src/auth";

describe("resolveField", () => {
  it.each([
    { case: "a top-level field", source: { username: "jdoe" }, field: "username", expected: "jdoe" },
    { case: "a nested field", source: { user: { name: "jdoe" } }, field: "user[name]", expected: "jdoe" },
    { case: "a deeply nested field", source: { a: { b: { c: "deep" } } }, field: "a[b][c]", expected: "deep" },
    { case: "an empty string, left for the caller to reject", source: { username: "" }, field: "username", expected: "" },

    { case: "a missing field", source: { username: "jdoe" }, field: "password", expected: null },
    { case: "a path that breaks part-way", source: { user: "jdoe" }, field: "user[name]", expected: null },
    { case: "an undefined source", source: undefined, field: "username", expected: null },
    { case: "a null source", source: null, field: "username", expected: null },
    { case: "a non-object source", source: "jdoe", field: "username", expected: null },

    { case: "an object value, not coerced", source: { password: { $ne: null } }, field: "password", expected: null },
    { case: "an array value, not coerced", source: { password: ["hunter2"] }, field: "password", expected: null },
    { case: "a number value, not coerced", source: { password: 1234 }, field: "password", expected: null },
    { case: "a boolean value, not coerced", source: { password: true }, field: "password", expected: null },

    { case: "an inherited constructor", source: {}, field: "constructor", expected: null },
    { case: "an inherited __proto__", source: {}, field: "__proto__", expected: null },
    { case: "an inherited toString", source: {}, field: "toString", expected: null },
  ])("returns $expected for $case", ({ source, field, expected }) => {
    expect(resolveField(source, field)).toBe(expected);
  });
});
