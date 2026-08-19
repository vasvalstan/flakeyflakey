import type { ComponentPropsWithoutRef } from "react";
import { FlaskConical } from "lucide-react";

export interface BrandMarkProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  collapsed?: boolean;
  productName?: string;
  showWordmark?: boolean;
}

export function BrandMark({
  className,
  collapsed,
  productName = "Flakey",
  showWordmark = true,
  ...props
}: BrandMarkProps) {
  const isCollapsed = collapsed ?? !showWordmark;
  const classes = [
    "brand-mark",
    isCollapsed ? "brand-mark--collapsed" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...props}>
      <span aria-hidden="true" className="brand-mark__symbol">
        <FlaskConical size={20} strokeWidth={2.25} />
      </span>
      <span className={isCollapsed ? "sr-only" : "brand-mark__wordmark"}>
        {productName}
      </span>
    </div>
  );
}

export default BrandMark;
