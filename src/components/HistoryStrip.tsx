import type { ComponentPropsWithoutRef } from "react";

import type { TestHistoryPoint } from "../types";
import { STATUS_DETAILS } from "./StatusBadge";

export interface HistoryStripProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  getRunHref?: (point: TestHistoryPoint) => string | undefined;
  history: readonly TestHistoryPoint[];
  limit?: number;
}

export function HistoryStrip({
  "aria-label": ariaLabel = "Recent test history",
  className,
  getRunHref,
  history,
  limit = 5,
  ...props
}: HistoryStripProps) {
  const itemLimit = Math.max(0, Math.floor(limit));
  const visibleHistory = itemLimit === 0 ? [] : history.slice(-itemLimit);
  const classes = ["history-strip", className].filter(Boolean).join(" ");

  return (
    <div
      aria-label={ariaLabel}
      className={classes}
      role="list"
      {...props}
    >
      {visibleHistory.length === 0 ? (
        <span className="history-strip__empty">No runs yet</span>
      ) : (
        visibleHistory.map((item, index) => {
          const statusLabel = STATUS_DETAILS[item.status].label;
          const itemLabel = `Run #${item.runSequence}: ${statusLabel} on ${item.branch} at ${item.commit}`;
          const tickClassName = [
            "history-strip__tick",
            `history-strip__tick--${item.status}`,
          ].join(" ");
          const isNewest = index === visibleHistory.length - 1;
          const href = getRunHref?.(item);

          if (href) {
            return (
              <a
                aria-label={itemLabel}
                className={tickClassName}
                data-newest={isNewest ? "true" : undefined}
                data-status={item.status}
                href={href}
                key={item.id}
                role="listitem"
                title={itemLabel}
              />
            );
          }

          return (
            <span
              aria-label={itemLabel}
              className={tickClassName}
              data-newest={isNewest ? "true" : undefined}
              data-status={item.status}
              key={item.id}
              role="listitem"
              title={itemLabel}
            />
          );
        })
      )}
    </div>
  );
}

export default HistoryStrip;
