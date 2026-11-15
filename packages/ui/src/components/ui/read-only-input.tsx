import * as React from "react"
import { Lock } from "lucide-react"

import { cn } from "../../lib/utils"
import { Input } from "./input"

export interface ReadOnlyInputProps
  extends Omit<React.ComponentProps<"input">, "readOnly"> {
  /**
   * Short explanation of why the value cannot be edited, rendered directly
   * under the field. Without it a locked field gives no recovery path.
   */
  hint?: string
}

/**
 * A field whose value is derived elsewhere (e.g. a postal code filled in from
 * the chosen region). Read-only state is never colour-only: the lock icon and
 * the muted text say "locked" on their own.
 */
const ReadOnlyInput = React.forwardRef<HTMLInputElement, ReadOnlyInputProps>(
  ({ className, hint, id, ...props }, ref) => {
    const hintId = id ? `${id}-hint` : undefined
    return (
      <div className="space-y-1">
        <div className="relative">
          <Input
            id={id}
            ref={ref}
            readOnly
            aria-describedby={hintId}
            className={cn("pr-9", className)}
            {...props}
          />
          <Lock
            aria-hidden="true"
            data-testid="read-only-lock"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        {hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    )
  }
)
ReadOnlyInput.displayName = "ReadOnlyInput"

export { ReadOnlyInput }
