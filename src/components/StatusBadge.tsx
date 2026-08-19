import type { ComponentPropsWithoutRef } from "react";
import {
  Check,
  CircleDot,
  CircleSlash2,
  Shield,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { TestStatus } from "../types";

interface StatusDetails {
  Icon: LucideIcon;
  label: string;
}

export const STATUS_DETAILS = {
  passed: { Icon: Check, label: "Passed" },
  failed: { Icon: X, label: "Failed" },
  flaky: { Icon: Zap, label: "Flaky" },
  skipped: { Icon: CircleSlash2, label: "Skipped" },
  running: { Icon: CircleDot, label: "Running" },
  quarantined: { Icon: Shield, label: "Quarantined" },
  blocked: { Icon: TriangleAlert, label: "Blocked" },
} satisfies Record<TestStatus, StatusDetails>;

export interface StatusBadgeProps
  extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  label?: string;
  size?: "sm" | "md";
  status: TestStatus;
}

export function StatusBadge({
  className,
  label,
  size = "md",
  status,
  title,
  ...props
}: StatusBadgeProps) {
  const { Icon, label: defaultLabel } = STATUS_DETAILS[status];
  const displayLabel = label ?? defaultLabel;
  const classes = [
    "status-badge",
    `status-badge--${status}`,
    `status-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      data-status={status}
      title={title ?? displayLabel}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className="status-badge__icon"
        size={14}
        strokeWidth={2.25}
      />
      <span className={size === "sm" ? "sr-only" : "status-badge__label"}>
        {displayLabel}
      </span>
    </span>
  );
}

export default StatusBadge;
