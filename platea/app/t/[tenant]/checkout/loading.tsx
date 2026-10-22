export default function CheckoutLoading() {
  return (
    <div className="min-h-screen bg-gray-950 animate-pulse">
      {/* Navbar skeleton */}
      <div className="h-16 bg-gray-900 border-b border-gray-800" />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Back link + title */}
        <div className="h-5 w-24 bg-gray-800 rounded" />
        <div className="h-7 w-48 bg-gray-800 rounded-lg" />

        {/* Cart item rows */}
        {[1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-800 bg-gray-900 p-4 space-y-3">
            <div className="flex justify-between items-start gap-3">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-2/3 bg-gray-800 rounded" />
                <div className="h-3 w-1/3 bg-gray-800 rounded" />
              </div>
              <div className="h-4 w-16 bg-gray-800 rounded" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gray-800" />
              <div className="h-4 w-6 bg-gray-800 rounded" />
              <div className="h-8 w-8 rounded-full bg-gray-800" />
            </div>
          </div>
        ))}

        {/* Total + CTA */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="flex justify-between">
            <div className="h-4 w-20 bg-gray-800 rounded" />
            <div className="h-4 w-24 bg-gray-800 rounded" />
          </div>
          <div className="h-12 w-full bg-gray-800 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
