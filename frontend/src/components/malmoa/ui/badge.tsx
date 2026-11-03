import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Windows 98 이름표: 각진 칸에 검은 테두리, 도트 글꼴
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border border-black px-1.5 font-pixel text-[13px] leading-5 whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        // meerkit 화면이 쓰는 이름 — 기본 이름표와 같게 그린다
        brand: "bg-primary text-primary-foreground",
        secondary: "bg-light text-black",
        destructive: "bg-error text-white",
        outline: "bg-white text-black",
        ghost: "border-transparent text-black",
        link: "border-transparent text-primary underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
