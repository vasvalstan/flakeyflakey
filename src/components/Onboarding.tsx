import { useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Code2,
  Gauge,
  MousePointer2,
  Play,
  Sparkles,
} from "lucide-react";

import BrandMark from "./BrandMark";

type CoverageMode = "both" | "automation" | "manual";
type StartMode = "demo" | "connect";

type OnboardingProps = {
  onComplete: (projectName: string, releaseName: string) => void;
};

const COVERAGE_OPTIONS: Array<{
  value: CoverageMode;
  title: string;
  description: string;
  icon: typeof Code2;
}> = [
  {
    value: "both",
    title: "Automation + manual",
    description: "One release signal across Playwright and hands-on QA.",
    icon: Sparkles,
  },
  {
    value: "automation",
    title: "Automation first",
    description: "Bring runs, evidence, history, and flakes into focus.",
    icon: Code2,
  },
  {
    value: "manual",
    title: "Manual first",
    description: "Plan cases and guide every test session step by step.",
    icon: MousePointer2,
  },
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("Acme Checkout");
  const [releaseName, setReleaseName] = useState("Summer checkout");
  const [coverage, setCoverage] = useState<CoverageMode>("both");
  const [startMode, setStartMode] = useState<StartMode>("demo");
  const [copied, setCopied] = useState(false);

  const setupCommand = "bunx @flakey/playwright run --project acme-checkout";

  const copyCommand = async () => {
    await navigator.clipboard?.writeText(setupCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="onboarding-shell" aria-labelledby="onboarding-title">
      <section className="onboarding-story" aria-label="Product introduction">
        <BrandMark showWordmark />
        <div className="onboarding-story-copy">
          <div className="eyebrow eyebrow-accent">
            <Sparkles size={13} aria-hidden="true" />
            Release confidence, without the noise
          </div>
          <h1 id="onboarding-title">
            Know if you can ship.
            <span>Know exactly why.</span>
          </h1>
          <p>
            Flakey brings automated runs, manual checks, and every piece of evidence into one calm release signal.
          </p>
        </div>

        <div className="onboarding-preview" aria-hidden="true">
          <div className="preview-topline">
            <span>RELEASE READINESS</span>
            <span>Updated now</span>
          </div>
          <div className="preview-verdict">
            <div className="preview-score"><Gauge size={25} /> 86</div>
            <div>
              <strong>AT RISK</strong>
              <span>3 clear actions before release</span>
            </div>
          </div>
          <div className="preview-reasons">
            <span><i className="preview-dot preview-dot-fail" /> Checkout smoke failed</span>
            <span><i className="preview-dot preview-dot-flaky" /> 2 manual checks remain</span>
            <span className="preview-resolved"><Check size={14} /> 218 tests passed</span>
          </div>
        </div>

        <div className="onboarding-proof">
          <span><Check size={14} /> Useful in under 60 seconds</span>
          <span><Check size={14} /> No configuration maze</span>
        </div>
      </section>

      <section className="onboarding-panel">
        <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((item) => (
            <span key={item} className={item <= step ? "is-active" : ""} />
          ))}
        </div>

        {step === 1 ? (
          <div className="onboarding-step animate-in">
            <div className="step-count">01 / 03</div>
            <h2>Set your release home</h2>
            <p>Two names are enough. Everything else can wait.</p>

            <div className="form-stack">
              <label className="field-label" htmlFor="project-name">Project name</label>
              <input
                id="project-name"
                className="text-input input-large"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                autoFocus
              />
              <label className="field-label" htmlFor="release-name">First release</label>
              <input
                id="release-name"
                className="text-input input-large"
                value={releaseName}
                onChange={(event) => setReleaseName(event.target.value)}
              />
            </div>

            <button
              className="button button-primary button-large onboarding-next"
              onClick={() => setStep(2)}
              disabled={!projectName.trim() || !releaseName.trim()}
            >
              Continue <ArrowRight size={17} />
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onboarding-step animate-in">
            <div className="step-count">02 / 03</div>
            <h2>What should Flakey unite?</h2>
            <p>Start focused. You can add more coverage whenever you are ready.</p>

            <div className="choice-stack" role="radiogroup" aria-label="Coverage type">
              {COVERAGE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    className={`choice-card ${coverage === option.value ? "is-selected" : ""}`}
                    role="radio"
                    aria-checked={coverage === option.value}
                    onClick={() => setCoverage(option.value)}
                  >
                    <span className="choice-icon"><Icon size={18} /></span>
                    <span className="choice-copy">
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <span className="choice-check"><Check size={14} /></span>
                  </button>
                );
              })}
            </div>

            <div className="onboarding-actions">
              <button className="button button-ghost" onClick={() => setStep(1)}>Back</button>
              <button className="button button-primary button-large" onClick={() => setStep(3)}>
                Continue <ArrowRight size={17} />
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="onboarding-step animate-in">
            <div className="step-count">03 / 03</div>
            <h2>Choose your first signal</h2>
            <p>Explore a complete release now, or connect Playwright with one command.</p>

            <div className="start-mode-tabs" role="tablist" aria-label="First signal options">
              <button
                role="tab"
                aria-selected={startMode === "demo"}
                className={startMode === "demo" ? "is-active" : ""}
                onClick={() => setStartMode("demo")}
              >
                <Play size={15} /> Explore demo
              </button>
              <button
                role="tab"
                aria-selected={startMode === "connect"}
                className={startMode === "connect" ? "is-active" : ""}
                onClick={() => setStartMode("connect")}
              >
                <Code2 size={15} /> Connect Playwright
              </button>
            </div>

            {startMode === "demo" ? (
              <div className="demo-ready-card">
                <div className="demo-ready-icon"><Check size={20} /></div>
                <div>
                  <strong>Your command center is ready</strong>
                  <p>One release, 153 automated tests, 26 manual cases, and real evidence are waiting.</p>
                </div>
                <div className="demo-ready-metrics">
                  <span><strong>92.2%</strong> automation</span>
                  <span><strong>84%</strong> manual</span>
                  <span><strong>3</strong> blockers</span>
                </div>
              </div>
            ) : (
              <div className="connect-card">
                <span className="field-label">Run in your Playwright project</span>
                <div className="command-block">
                  <code>{setupCommand}</code>
                  <button className="icon-button" onClick={copyCommand} aria-label="Copy setup command">
                    {copied ? <Check size={16} /> : <Clipboard size={16} />}
                  </button>
                </div>
                <div className="waiting-signal">
                  <span className="running-dot" /> Waiting for your first run
                </div>
              </div>
            )}

            <div className="onboarding-actions">
              <button className="button button-ghost" onClick={() => setStep(2)}>Back</button>
              <button className="button button-primary button-large" onClick={() => onComplete(projectName.trim(), releaseName.trim())}>
                {startMode === "demo" ? "Open command center" : "Continue with sample data"}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        ) : null}

        <p className="onboarding-footnote">No credit card · Demo data stays in this browser</p>
      </section>
    </main>
  );
}
