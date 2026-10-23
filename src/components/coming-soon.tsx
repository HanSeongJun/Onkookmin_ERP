import type { LucideIcon } from "lucide-react"

/**
 * Placeholder box for a screen that hasn't been built yet.
 * Lists the features that are planned for it.
 */
export function ComingSoon({
  icon: Icon,
  description,
  plannedFeatures,
}: {
  icon: LucideIcon
  description: string
  plannedFeatures: string[]
}) {
  return (
    <section
      className="border border-input"
      aria-labelledby="coming-soon-title"
    >
      <div className="flex items-center gap-2 border-b border-input bg-label px-4 py-2.5">
        <Icon aria-hidden="true" className="size-4 text-brand" />
        <h2 id="coming-soon-title" className="font-bold">
          곧 제공될 예정입니다
        </h2>
        <span className="ml-auto rounded-sm bg-brand-tint px-2 py-0.5 text-xs font-bold text-brand-active">
          준비 중
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-muted-foreground">{description}</p>
        <div>
          <p className="mb-1.5 font-bold">준비 중인 기능</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground marker:text-brand">
            {plannedFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
