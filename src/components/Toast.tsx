import { CheckCircle2, X } from "lucide-react";

type ToastProps = {
  message: string;
  onDismiss: () => void;
};

export default function Toast({ message, onDismiss }: ToastProps) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <CheckCircle2 size={17} aria-hidden="true" />
      <span>{message}</span>
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  );
}
