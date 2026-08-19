import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import { studioApi, StudioApiError } from "../studio/api";
import type { StudioSavedFlow } from "../studio/types";
import { SavedFlowDetail } from "./SavedFlowDetail";

interface SavedFlowPageProps {
  flowId: string;
  onBack: () => void;
  onDeleted: () => void;
  onToast: (message: string) => void;
}

function displayError(error: unknown) {
  if (error instanceof StudioApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Flakey could not load this saved recording.";
}

export default function SavedFlowPage({
  flowId,
  onBack,
  onDeleted,
  onToast,
}: SavedFlowPageProps) {
  const [flow, setFlow] = useState<StudioSavedFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setFlow(null);
    setError(null);

    void studioApi.getSavedFlow(flowId, controller.signal)
      .then(setFlow)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(displayError(loadError));
      });

    return () => controller.abort();
  }, [flowId, reloadRevision]);

  const deleteFlow = async () => {
    if (!flow || !window.confirm(`Delete “${flow.name}” from Flakey?`)) return;

    setDeleting(true);
    try {
      await studioApi.deleteSavedFlow(flow.id);
      onToast("Saved flow deleted");
      onDeleted();
    } catch (deleteError) {
      onToast(displayError(deleteError));
      setDeleting(false);
    }
  };

  if (flow) {
    return (
      <main className="saved-flow-page">
        <SavedFlowDetail
          deleting={deleting}
          flow={flow}
          onBack={onBack}
          onDelete={() => void deleteFlow()}
        />
      </main>
    );
  }

  return (
    <main className="saved-flow-page saved-flow-page-state" aria-busy={!error}>
      <section className="saved-flow-state-card" role={error ? "alert" : "status"}>
        <span className={`saved-flow-state-icon ${error ? "is-error" : ""}`}>
          {error
            ? <AlertTriangle aria-hidden="true" size={22} />
            : <LoaderCircle aria-hidden="true" className="spin" size={22} />}
        </span>
        <div>
          <p className="saved-flow-state-eyebrow">Saved recording</p>
          <h1>{error ? "This flow could not be opened" : "Opening recorded flow…"}</h1>
          <p>{error ?? "Loading its steps, locators, screenshots, and semantic enrichment."}</p>
        </div>
        <div className="saved-flow-state-actions">
          <button className="saved-flow-control" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            Recorded flows
          </button>
          {error ? (
            <button
              className="saved-flow-control"
              onClick={() => setReloadRevision((current) => current + 1)}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Try again
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
