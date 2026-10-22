import assert from "node:assert/strict"
import test from "node:test"
import TenantConsumiblesCheckoutPage from "@/app/t/[tenant]/consumibles/checkout/page"
import { renderConsumiblesCheckoutEntryForTenant } from "./page"

test("consumibles checkout alias preserves canonical tenant params", async () => {
  const tree = renderConsumiblesCheckoutEntryForTenant("acme") as {
    props: {
      tenant: string
      children: {
        type: unknown
        props: { params: Promise<{ tenant: string }> }
      }
    }
  }

  assert.equal(tree.props.tenant, "acme")
  assert.equal(tree.props.children.type, TenantConsumiblesCheckoutPage)
  assert.deepEqual(await tree.props.children.props.params, { tenant: "acme" })
})
