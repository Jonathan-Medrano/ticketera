/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/ban-ts-comment */
// @ts-nocheck
const { equal } = require("node:assert/strict") as Pick<typeof import("node:assert/strict"), "equal">
const { test } = require("node:test") as typeof import("node:test")
const { getEffectiveTheme, isSuperAdminTheme, normalizeSuperAdminTheme } = require("./theme.ts") as typeof import("./theme")

test("superadmin theme helpers normalize storage and resolved values", () => {
  equal(isSuperAdminTheme("dark"), true)
  equal(isSuperAdminTheme("light"), true)
  equal(isSuperAdminTheme("system"), false)

  equal(normalizeSuperAdminTheme("dark"), "dark")
  equal(normalizeSuperAdminTheme("light"), "light")
  equal(normalizeSuperAdminTheme("system"), "light")
  equal(normalizeSuperAdminTheme(null, "light"), "light")

  equal(getEffectiveTheme("system", "dark"), "dark")
  equal(getEffectiveTheme("dark", "light"), "light")
  equal(getEffectiveTheme("light", null), "light")
  equal(getEffectiveTheme("system", undefined), "light")
})
