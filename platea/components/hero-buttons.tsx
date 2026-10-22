"use client"

import MarketingActions from "@/components/marketing-actions"

export default function HeroButtons() {
  return (
    <MarketingActions
      className="flex flex-col justify-center gap-4 sm:flex-row"
      secondaryHref="#producto"
      secondaryLabel="Ver producto"
    />
  )
}
