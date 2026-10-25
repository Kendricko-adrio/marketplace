import * as React from "react"

import { cn } from "../../lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, readOnly, ...props }, ref) => {
  return (
    <textarea
      readOnly={readOnly}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-field px-3 py-2 text-base ring-offset-background placeholder:text-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        readOnly && "cursor-default bg-muted text-muted-foreground",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }