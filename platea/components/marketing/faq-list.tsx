type FaqItem = {
  question: string
  answer: string
}

type FaqListProps = {
  items: readonly FaqItem[]
}

export default function FaqList({ items }: FaqListProps) {
  return (
    <div className="space-y-3">
      {items.map(({ question, answer }) => (
        <article
          key={question}
          className="group rounded-card overflow-hidden transition-colors duration-200"
          style={{
            border: "1px solid var(--marketing-border)",
            background: "var(--marketing-surface)",
          }}
        >
          <div
            className="flex items-start gap-4 px-6 py-5"
          >
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors group-hover:bg-[color:var(--marketing-accent)] group-hover:text-white dark:group-hover:text-[color:var(--marketing-action-primary-text)]"
              style={{
                background: "var(--marketing-accent-soft)",
                color: "var(--marketing-accent)",
              }}
              aria-hidden="true"
            >
              ?
            </span>
            <div className="space-y-2">
              <h3
                className="text-base font-semibold leading-snug"
                style={{ color: "var(--marketing-ink-strong)" }}
              >
                {question}
              </h3>
              <p
                className="marketing-page-body leading-relaxed"
                style={{ color: "var(--marketing-ink)", opacity: 0.82 }}
              >
                {answer}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
