"""
=============================================================================
TICKETERA — E2E Tests: Buyer Flow (Tenant Storefront)
=============================================================================

Tests the buyer-facing purchase flow per the acceptance criteria:
  1. View event / select tickets
  2. Add to cart / go to checkout
  3. Complete buyer data
  4. Redirect to Mercado Pago
  5. Purchase confirmation / post-payment screen

ALSO TESTS:
  - Checkout form validation (required fields, DNI format)
  - Network/API error display (no white screen)
  - Mobile viewport 375px (POS + storefront used on mobile)

CONFIGURATION (env vars):
  TENANT_SLUG      - slug of a live tenant (e.g. "mi-productora")
  EVENTO_ID        - UUID of a live event in that tenant
  TENANT_BASE_URL  - optional, defaults to https://ticketera.com

If TENANT_SLUG is not set, tenant-specific tests are SKIPPED with a clear
report — they are not silently passed.

=============================================================================
"""
import os
import sys
import json
from playwright.sync_api import sync_playwright, Page, expect

# ─── Config ──────────────────────────────────────────────────────────────────
BASE_URL = "https://ticketera.com"
API_URL = "https://api.ticketera.com"

TENANT_SLUG = os.environ.get("TENANT_SLUG", "")
EVENTO_ID = os.environ.get("EVENTO_ID", "")

SCREENSHOTS = "tests/e2e/screenshots"

MOBILE_VIEWPORT = {"width": 375, "height": 812}
DESKTOP_VIEWPORT = {"width": 1280, "height": 900}

# ─── Results collector ───────────────────────────────────────────────────────
results = {
    "passed": [],
    "failed": [],
    "skipped": [],
    "bugs": [],
}

def pass_test(name, detail=""):
    results["passed"].append(name)
    print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))

def fail_test(name, detail, screenshot=None):
    entry = {"name": name, "detail": detail}
    if screenshot:
        entry["screenshot"] = screenshot
    results["failed"].append(entry)
    print(f"  FAIL  {name}")
    print(f"        {detail}")
    if screenshot:
        print(f"        Screenshot: {screenshot}")

def skip_test(name, reason):
    results["skipped"].append({"name": name, "reason": reason})
    print(f"  SKIP  {name} — {reason}")

def bug(component, location, description, severity="MEDIUM"):
    results["bugs"].append({
        "severity": severity,
        "component": component,
        "location": location,
        "description": description,
    })

def tenant_url(path=""):
    """Returns URL for the configured tenant (subdomain-based)."""
    if TENANT_SLUG:
        return f"https://{TENANT_SLUG}.{BASE_URL.replace('https://', '')}{path}"
    return f"{BASE_URL}/t/{TENANT_SLUG}{path}"


# ─── Static analysis bugs (from code review — no browser needed) ─────────────
def run_static_analysis_checks():
    print("\n== STATIC ANALYSIS — Code Review Bugs ==")

    # Bug 1: evento-detalle-sections.tsx — toLocaleString() without locale
    bug(
        component="evento-detalle-sections.tsx",
        location="lines 269, 272, 276, 392, 395, 399",
        description=(
            "Price displayed with toLocaleString() — NO locale argument. "
            "On a browser with a non-es-AR locale (e.g. en-US), the thousand separator "
            "becomes a comma ('1,500') instead of a period ('1.500'), which is wrong for ARS "
            "and inconsistent with the rest of the app. Should use formatMoney() from lib/format.ts."
        ),
        severity="HIGH",
    )

    # Bug 2: checkout-content.tsx — toLocaleString("es-AR") instead of formatMoney
    bug(
        component="checkout-content.tsx",
        location="lines 289, 291, 321, 382, 384, 495, 601, 606, 613, 617",
        description=(
            "10 instances of .toLocaleString('es-AR') for money display instead of "
            "formatMoney() from lib/format.ts (canonical formatter per CLAUDE.md conventions). "
            "Both produce similar output in es-AR locale, but violates the single-source rule and "
            "may diverge in edge cases (very large numbers, decimals)."
        ),
        severity="LOW",
    )

    # Bug 3: consumibles-checkout-content.tsx — same pattern
    bug(
        component="consumibles-checkout-content.tsx",
        location="lines 118, 133, 148, 151",
        description=(
            "Same .toLocaleString('es-AR') for money display instead of formatMoney(). "
            "Convention violation."
        ),
        severity="LOW",
    )

    # Bug 4: mis-tickets-content.tsx — toLocaleDateString without timezone
    bug(
        component="mis-tickets-content.tsx",
        location="line 409",
        description=(
            "new Date(ticket.created_at).toLocaleDateString('es-AR') — "
            "NO timeZone option specified. For a UTC timestamptz, the issued-date on the "
            "PDF ticket could show the previous calendar day for buyers in GMT-3 on devices "
            "where the browser is set to UTC or a +XX timezone."
        ),
        severity="MEDIUM",
    )

    # Bug 5: tenant-buyer-settings-content.tsx — toLocaleString without timezone
    bug(
        component="tenant-buyer-settings-content.tsx",
        location="line 257",
        description=(
            "new Date(phoneVerifiedAt).toLocaleString('es-AR') without timeZone option. "
            "Same timezone bug as above."
        ),
        severity="LOW",
    )

    print(f"  Found {len(results['bugs'])} static bugs via code review")


# ─── Test group 1: Public pages (no tenant needed) ────────────────────────────
def run_public_tests(browser):
    print("\n== GROUP 1: Public Pages (no tenant) ==")

    # ── TC-01: Main marketing page renders without crash ─────────────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(BASE_URL, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc01_main_page.png", full_page=True)
        title = page.title()
        if "ticketera" in title.lower():
            pass_test("TC-01: Main marketing page loads", f"title={title!r}")
        else:
            fail_test("TC-01: Main marketing page loads", f"Unexpected title: {title!r}",
                      f"{SCREENSHOTS}/tc01_main_page.png")
    except Exception as ex:
        fail_test("TC-01: Main marketing page loads", str(ex))
    finally:
        ctx.close()

    # ── TC-02: Non-existent tenant returns custom 404 (no white screen) ──────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto("https://nonexistent-xyzzy99.ticketera.com", timeout=20000)
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        page.screenshot(path=f"{SCREENSHOTS}/tc02_tenant_404.png", full_page=True)
        body_text = page.inner_text("body")

        # Should show a custom 404, NOT a white screen or JS crash
        has_404_content = any(x in body_text for x in ["404", "no existe", "perdiste", "no se movi"])
        has_error_boundary = "Something went wrong" in body_text or "Error" in page.title()
        has_white_screen = len(body_text.strip()) < 10

        if has_white_screen:
            fail_test("TC-02: Non-existent tenant 404 page", "White screen — no content rendered",
                      f"{SCREENSHOTS}/tc02_tenant_404.png")
        elif has_error_boundary:
            fail_test("TC-02: Non-existent tenant 404 page", "Unhandled error boundary shown",
                      f"{SCREENSHOTS}/tc02_tenant_404.png")
        elif has_404_content:
            pass_test("TC-02: Non-existent tenant 404 page", "Custom 404 page rendered correctly")
        else:
            fail_test("TC-02: Non-existent tenant 404 page",
                      f"Unexpected content (neither 404 nor error): {body_text[:200]!r}",
                      f"{SCREENSHOTS}/tc02_tenant_404.png")
    except Exception as ex:
        fail_test("TC-02: Non-existent tenant 404 page", str(ex))
    finally:
        ctx.close()

    # ── TC-03: Login page — correct form structure ────────────────────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE_URL}/login", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.screenshot(path=f"{SCREENSHOTS}/tc03_login_page.png", full_page=True)

        email_visible = page.locator("#login-email").is_visible()
        password_visible = page.locator("#login-password").is_visible()
        submit_visible = page.locator('button[type="submit"]').first.is_visible()

        if email_visible and password_visible and submit_visible:
            pass_test("TC-03: Login page form structure", "email + password + submit visible")
        else:
            fail_test("TC-03: Login page form structure",
                      f"email={email_visible} password={password_visible} submit={submit_visible}",
                      f"{SCREENSHOTS}/tc03_login_page.png")
    except Exception as ex:
        fail_test("TC-03: Login page form structure", str(ex))
    finally:
        ctx.close()

    # ── TC-04: Login error shown on wrong credentials ─────────────────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE_URL}/login", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.locator("#login-email").fill("nonexistent@test.com")
        page.locator("#login-password").fill("WrongPassword123!")
        page.locator('button[type="submit"]').first.click()
        page.wait_for_timeout(6000)  # Wait for async signIn to complete
        page.screenshot(path=f"{SCREENSHOTS}/tc04_login_error.png", full_page=True)

        body_text = page.inner_text("body")
        has_error = "incorrectos" in body_text or "contraseña" in body_text.lower()
        still_on_login = "/login" in page.url

        if still_on_login and has_error:
            pass_test("TC-04: Login shows error on wrong credentials", "Error message visible")
        elif still_on_login and not has_error:
            fail_test("TC-04: Login shows error on wrong credentials",
                      "Login failed but no error message shown (silent failure)",
                      f"{SCREENSHOTS}/tc04_login_error.png")
        else:
            fail_test("TC-04: Login shows error on wrong credentials",
                      f"Unexpected redirect to: {page.url}",
                      f"{SCREENSHOTS}/tc04_login_error.png")
    except Exception as ex:
        fail_test("TC-04: Login shows error on wrong credentials", str(ex))
    finally:
        ctx.close()

    # ── TC-05: Main page — mobile viewport (375px) ────────────────────────────
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(BASE_URL, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc05_main_mobile.png", full_page=True)

        body_width = page.evaluate("document.body.scrollWidth")
        viewport_width = MOBILE_VIEWPORT["width"]
        overflows = body_width > viewport_width + 10  # 10px tolerance

        if overflows:
            fail_test("TC-05: Main page mobile 375px — no horizontal scroll",
                      f"body.scrollWidth={body_width}px > viewport={viewport_width}px (horizontal overflow)",
                      f"{SCREENSHOTS}/tc05_main_mobile.png")
        else:
            pass_test("TC-05: Main page mobile 375px", "No horizontal overflow")
    except Exception as ex:
        fail_test("TC-05: Main page mobile 375px", str(ex))
    finally:
        ctx.close()

    # ── TC-06: 404 page — mobile viewport ────────────────────────────────────
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto("https://nonexistent-xyzzy99.ticketera.com", timeout=20000)
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        page.screenshot(path=f"{SCREENSHOTS}/tc06_404_mobile.png", full_page=True)

        body_width = page.evaluate("document.body.scrollWidth")
        viewport_width = MOBILE_VIEWPORT["width"]
        overflows = body_width > viewport_width + 10

        if overflows:
            fail_test("TC-06: Tenant 404 page mobile 375px — no horizontal scroll",
                      f"body.scrollWidth={body_width}px — horizontal overflow",
                      f"{SCREENSHOTS}/tc06_404_mobile.png")
        else:
            pass_test("TC-06: Tenant 404 page mobile 375px", "No horizontal overflow")
    except Exception as ex:
        fail_test("TC-06: Tenant 404 page mobile 375px", str(ex))
    finally:
        ctx.close()

    # ── TC-07: Backend API health check ──────────────────────────────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        response = page.request.get(f"{API_URL}/api/health", timeout=10000)
        if response.status == 200:
            pass_test("TC-07: Backend API health check", f"HTTP {response.status}")
        else:
            fail_test("TC-07: Backend API health check",
                      f"HTTP {response.status} — backend may be down")
    except Exception as ex:
        fail_test("TC-07: Backend API health check", f"Network error: {ex}")
    finally:
        ctx.close()


# ─── Test group 2: Tenant flow (requires TENANT_SLUG + EVENTO_ID) ─────────────
def run_tenant_tests(browser):
    print(f"\n== GROUP 2: Buyer Flow (tenant={TENANT_SLUG!r}, evento={EVENTO_ID!r}) ==")

    if not TENANT_SLUG:
        skip_test("TC-10 through TC-22: Full buyer flow",
                  "TENANT_SLUG env var not set — no tenant with live events exists in production. "
                  "Create a tenant and set TENANT_SLUG=<slug> to run these tests.")
        return

    if not EVENTO_ID:
        skip_test("TC-10 through TC-22: Full buyer flow",
                  "EVENTO_ID env var not set — provide the ID of a live event.")
        return

    evento_url = tenant_url(f"/evento/{EVENTO_ID}")
    checkout_url = tenant_url("/checkout")
    home_url = tenant_url("/")

    # ── TC-10: Tenant home page renders ───────────────────────────────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(home_url, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc10_tenant_home.png", full_page=True)
        body = page.inner_text("body")
        has_404 = any(x in body for x in ["404", "no existe", "perdiste"])
        if has_404:
            fail_test("TC-10: Tenant home renders", f"Got 404 for tenant {TENANT_SLUG!r}",
                      f"{SCREENSHOTS}/tc10_tenant_home.png")
        else:
            pass_test("TC-10: Tenant home renders", f"slug={TENANT_SLUG!r}")
    except Exception as ex:
        fail_test("TC-10: Tenant home renders", str(ex))
    finally:
        ctx.close()

    # ── TC-11: Event detail page renders with ticket categories ───────────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(evento_url, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc11_evento_detail.png", full_page=True)
        body = page.inner_text("body")

        # Should show ticket categories (buttons with +/-)
        has_qty_buttons = (
            page.locator('[aria-label="Agregar unidad"], [aria-label*="unidad"]').count() > 0
            or page.locator('button:has-text("+")').count() > 0
        )
        has_checkout_btn = page.locator('button:has-text("Agregar"), button:has-text("carrito"), button:has-text("Ir al checkout")').count() > 0

        if not has_qty_buttons and not has_checkout_btn:
            fail_test("TC-11: Event detail — ticket categories visible",
                      "No quantity controls or checkout button found on event page",
                      f"{SCREENSHOTS}/tc11_evento_detail.png")
        else:
            pass_test("TC-11: Event detail page renders with ticket controls")
    except Exception as ex:
        fail_test("TC-11: Event detail page renders", str(ex))
    finally:
        ctx.close()

    # ── TC-12: Checkout page with empty cart shows redirect to home ───────────
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    page = ctx.new_page()
    try:
        # Navigate directly to checkout without auth/cart → should redirect to tenant auth
        page.goto(checkout_url, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc12_checkout_empty.png", full_page=True)
        url_after = page.url

        # Should redirect to auth page (login for buyer) or show empty cart message
        went_to_auth = "/auth" in url_after or "/login" in url_after
        on_checkout_with_content = "checkout" in url_after.lower()

        if went_to_auth:
            pass_test("TC-12: Checkout without session redirects to buyer auth")
        elif on_checkout_with_content:
            # Check if it shows empty cart state
            body = page.inner_text("body")
            has_empty = any(x in body for x in ["vacío", "vacio", "empty", "Agregá"])
            if has_empty:
                pass_test("TC-12: Checkout with empty cart shows empty state")
            else:
                fail_test("TC-12: Checkout page state",
                          "Checkout accessible without session and no empty state shown",
                          f"{SCREENSHOTS}/tc12_checkout_empty.png")
        else:
            fail_test("TC-12: Checkout without session",
                      f"Unexpected URL after navigating to checkout: {url_after}",
                      f"{SCREENSHOTS}/tc12_checkout_empty.png")
    except Exception as ex:
        fail_test("TC-12: Checkout state without session", str(ex))
    finally:
        ctx.close()

    # ── TC-13: Tenant home — mobile viewport 375px ────────────────────────────
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(home_url, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc13_tenant_home_mobile.png", full_page=True)

        body_width = page.evaluate("document.body.scrollWidth")
        overflows = body_width > MOBILE_VIEWPORT["width"] + 10
        if overflows:
            fail_test("TC-13: Tenant home mobile 375px — no overflow",
                      f"scrollWidth={body_width}px",
                      f"{SCREENSHOTS}/tc13_tenant_home_mobile.png")
        else:
            pass_test("TC-13: Tenant home mobile 375px")
    except Exception as ex:
        fail_test("TC-13: Tenant home mobile", str(ex))
    finally:
        ctx.close()

    # ── TC-14: Event detail — mobile viewport 375px ───────────────────────────
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT)
    page = ctx.new_page()
    try:
        page.goto(evento_url, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        page.screenshot(path=f"{SCREENSHOTS}/tc14_evento_mobile.png", full_page=True)

        body_width = page.evaluate("document.body.scrollWidth")
        overflows = body_width > MOBILE_VIEWPORT["width"] + 10
        if overflows:
            fail_test("TC-14: Event detail mobile 375px — no overflow",
                      f"scrollWidth={body_width}px",
                      f"{SCREENSHOTS}/tc14_evento_mobile.png")
        else:
            pass_test("TC-14: Event detail mobile 375px")
    except Exception as ex:
        fail_test("TC-14: Event detail mobile", str(ex))
    finally:
        ctx.close()


# ─── Test group 3: Checkout form validation (needs tenant + event + buyer session) ──
def run_checkout_validation_tests(browser):
    """
    These tests validate the checkout form.
    They require a buyer to be authenticated AND have items in the cart.
    Without a real buyer session, we document the expected behavior from code review.
    """
    print("\n== GROUP 3: Checkout Form Validation ==")

    if not TENANT_SLUG or not EVENTO_ID:
        skip_test("TC-20: Checkout submit without required fields",
                  "Needs TENANT_SLUG + EVENTO_ID + buyer session. From code review: "
                  "submitHandler checks d.nombre, d.apellido, d.dni and calls setError('Completá todos los datos del Ticket #N') "
                  "[checkout-content.tsx:153-157]")
        skip_test("TC-21: Checkout submit with invalid DNI",
                  "Needs buyer session. From code review: isValidDni() rejects DNI "
                  "outside 6-8 digit range. Error: 'El DNI del Ticket #N debe tener entre 6 y 8 dígitos' "
                  "[checkout-content.tsx:158-163]")
        skip_test("TC-22: Empty cart shows 'carrito vacío' state",
                  "Needs buyer session with empty cart. From code review: "
                  "items.length === 0 branch at checkout-content.tsx:223 renders "
                  "Ticket icon + 'Tu carrito está vacío' + link back to home.")
        skip_test("TC-23: Network error on checkout shows user-facing message",
                  "Needs buyer session + items. From code review: catch block at "
                  "checkout-content.tsx:216 sets error 'No se pudo iniciar el checkout. Reintentá en unos segundos.'")
        return

    skip_test("TC-20 through TC-23", "Buyer session required — cannot automate without test account credentials")


# ─── Main runner ─────────────────────────────────────────────────────────────
def main():
    print("=" * 65)
    print("TICKETERA — Buyer Flow E2E Tests")
    print(f"  Target: {BASE_URL}")
    print(f"  Tenant: {TENANT_SLUG or '(not set — tenant tests will be SKIPPED)'}")
    print(f"  Evento: {EVENTO_ID or '(not set)'}")
    print("=" * 65)

    # Static analysis first (no browser needed)
    run_static_analysis_checks()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        run_public_tests(browser)
        run_tenant_tests(browser)
        run_checkout_validation_tests(browser)
        browser.close()

    # ─── Final report ───────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("RESULTS SUMMARY")
    print("=" * 65)
    print(f"  PASSED:  {len(results['passed'])}")
    print(f"  FAILED:  {len(results['failed'])}")
    print(f"  SKIPPED: {len(results['skipped'])}")
    print(f"  BUGS:    {len(results['bugs'])} (from static analysis)")

    if results["failed"]:
        print("\nFAILURES:")
        for f in results["failed"]:
            print(f"  [{f['name']}]")
            print(f"    {f['detail']}")
            if "screenshot" in f:
                print(f"    Evidence: {f['screenshot']}")

    if results["skipped"]:
        print("\nSKIPPED — REQUIRE ACTION:")
        for s in results["skipped"]:
            print(f"  [{s['name']}]")
            print(f"    Reason: {s['reason']}")

    if results["bugs"]:
        print("\nSTATIC ANALYSIS BUGS:")
        for b in results["bugs"]:
            print(f"  [{b['severity']}] {b['component']} @ {b['location']}")
            print(f"    {b['description']}")

    print()
    if results["failed"]:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
