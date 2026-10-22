import assert from "node:assert/strict"
import { test } from "node:test"
import { isMutationMethod, isSameOriginMutationAllowed } from "@/lib/csrf-origin"
import { buildRouteRateLimitKey } from "@/lib/route-rate-limit"

type RequestLike = {
  method: string
  headers: {
    get(name: string): string | null
  }
  nextUrl: {
    origin: string
  }
}

function buildRequest(method: string, origin: string | null, targetOrigin = "https://ticketera.com"): RequestLike {
  return {
    method,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "origin") return origin
        return null
      },
    },
    nextUrl: {
      origin: targetOrigin,
    },
  }
}

test("mutation methods are detected correctly", () => {
  assert.equal(isMutationMethod("POST"), true)
  assert.equal(isMutationMethod("PATCH"), true)
  assert.equal(isMutationMethod("GET"), false)
})

test("same-origin mutation is allowed", () => {
  assert.equal(isSameOriginMutationAllowed(buildRequest("POST", "https://ticketera.com") as never), true)
})

test("cross-origin same-site mutation is rejected", () => {
  assert.equal(isSameOriginMutationAllowed(buildRequest("POST", "https://evil.ticketera.com") as never), false)
})

test("local tenant alias is allowed in development when port matches", () => {
  const env = process.env as Record<string, string | undefined>
  const originalNodeEnv = process.env.NODE_ENV
  const originalRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN

  env.NODE_ENV = "development"
  env.NEXT_PUBLIC_ROOT_DOMAIN = "Ticketera.local:3000"

  assert.equal(
    isSameOriginMutationAllowed(
      buildRequest("POST", "http://empresaprueba.Ticketera.local:3000", "http://localhost:3000") as never
    ),
    true
  )

  env.NODE_ENV = originalNodeEnv
  env.NEXT_PUBLIC_ROOT_DOMAIN = originalRootDomain
})

test("mutation without origin is rejected", () => {
  assert.equal(isSameOriginMutationAllowed(buildRequest("POST", null) as never), false)
})

test("route rate limit key ignores spoofed IP when identifier exists", () => {
  const first = buildRouteRateLimitKey(
    {
      ...buildRequest("POST", "https://ticketera.com"),
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "x-forwarded-for") return "198.51.100.1"
          return null
        },
      },
    } as never,
    { prefix: "login", windowMs: 1000, max: 5, message: "x", identifier: "user@example.com" }
  )

  const second = buildRouteRateLimitKey(
    {
      ...buildRequest("POST", "https://ticketera.com"),
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "x-forwarded-for") return "203.0.113.99"
          return null
        },
      },
    } as never,
    { prefix: "login", windowMs: 1000, max: 5, message: "x", identifier: "user@example.com" }
  )

  assert.equal(first, second)
})
