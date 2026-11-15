import * as React from "react"

import { cn } from "../../lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, readOnly, ...props }, ref) => {
    return (
      <input
        type={type}
        readOnly={readOnly}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-field px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          // A read-only field must look locked, not merely un-styled. Driven by
          // the prop (not `read-only:`) because `:read-only` also matches
          // input[type=file], radio and checkbox.
          readOnly && "cursor-default bg-muted text-muted-foreground",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }