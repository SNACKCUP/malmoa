import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Windows 98 단추: 회색 입체, 누르면 안으로 들어간다. default는 "기본 단추"(검은 바깥 테두리)
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none font-pixel text-[15px] whitespace-nowrap text-black outline-none select-none w98-focus active:not-aria-[haspopup]:[&>*]:translate-x-px active:not-aria-[haspopup]:[&>*]:translate-y-px disabled:pointer-events-none disabled:text-shade disabled:[text-shadow:1px_1px_0_#fff] aria-invalid:outline aria-invalid:outline-1 aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "w98-out outline outline-1 -outline-offset-1 outline-black active:w98-pressed aria-expanded:w98-pressed aria-pressed:font-bold aria-pressed:w98-checked",
        // meerkit 화면이 쓰는 이름 (주요 동작 단추) — 98에는 브랜드 색 단추가 없어 기본 단추와 같게 그린다
        brand: "w98-out outline outline-1 -outline-offset-1 outline-black active:w98-pressed aria-expanded:w98-pressed",
        outline: "w98-out active:w98-pressed aria-expanded:w98-pressed aria-pressed:font-bold aria-pressed:w98-checked",
        secondary: "w98-out active:w98-pressed aria-expanded:w98-pressed",
        // 도구 막대 단추: 평소에는 납작하고, 올리면 튀어나온다
        ghost: "bg-transparent hover:w98-out active:w98-pressed aria-expanded:w98-pressed",
        destructive: "w98-out text-destructive active:w98-pressed",
        link: "font-sans text-primary underline underline-offset-2 hover:text-[#1084d0]",
      },
      size: {
        default: "h-8 min-w-16 gap-1.5 px-3",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-20 gap-1.5 px-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
        // meerkit 화면이 쓰는 이름 (입력칸 옆 단추) — 말모아 입력칸(h-8)과 높이를 맞춘다
        field: "h-8 gap-1.5 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
