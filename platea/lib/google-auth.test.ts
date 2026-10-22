import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildGoogleOnboardingRedirect,
  GOOGLE_AUTH_ERROR_CODES,
  resolveGoogleOnboardingPrefill,
  resolveGoogleProfileNames,
  resolveLoginErrorMessage,
} from "@/lib/google-auth"

test("google onboarding redirect preserves normalized email and prefill names", () => {
  const location = buildGoogleOnboardingRedirect({
    email: "  OWNER@Example.com ",
    firstName: " Ana ",
    lastName: " García ",
  })

  assert.equal(
    location,
    "/login?tab=registro&completar=true&oauth=google&email=owner%40example.com&nombre=Ana&apellido=Garc%C3%ADa"
  )
})

test("google onboarding prefill supports current and legacy query params", () => {
  const current = resolveGoogleOnboardingPrefill(
    new URLSearchParams("oauth=google&tab=registro&email=owner%40example.com&nombre=Ana&apellido=Garc%C3%ADa")
  )
  const legacy = resolveGoogleOnboardingPrefill(new URLSearchParams("completar=true&email=owner%40example.com"))

  assert.deepEqual(current, {
    isGoogleOnboarding: true,
    email: "owner@example.com",
    firstName: "Ana",
    lastName: "García",
  })
  assert.deepEqual(legacy, {
    isGoogleOnboarding: true,
    email: "owner@example.com",
    firstName: "",
    lastName: "",
  })
})

test("google profile names fall back to display name when profile fields are missing", () => {
  assert.deepEqual(resolveGoogleProfileNames({ given_name: "Ana", family_name: "García" }), {
    firstName: "Ana",
    lastName: "García",
  })

  assert.deepEqual(resolveGoogleProfileNames(undefined, "Ana María García"), {
    firstName: "Ana",
    lastName: "María García",
  })
})

test("login error mapper exposes actionable google messages", () => {
  assert.equal(
    resolveLoginErrorMessage(GOOGLE_AUTH_ERROR_CODES.emailUnavailable),
    "Google no devolvió un email válido para continuar. Probá con otra cuenta o usá email y contraseña."
  )
  assert.equal(
    resolveLoginErrorMessage(GOOGLE_AUTH_ERROR_CODES.inactiveAccount),
    "Encontramos tu empresa, pero está inactiva. Contactanos para reactivar el acceso."
  )
})
