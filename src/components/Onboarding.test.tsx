import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Onboarding from "./Onboarding";

test("onboarding shows the new headline and preserves supporting copy and structure", () => {
  const markup = renderToStaticMarkup(<Onboarding onComplete={() => {}} />);

  expect(markup).toContain('<main class="onboarding-shell" aria-labelledby="onboarding-title">');
  expect(markup).toContain('<h1 id="onboarding-title">Ready to ship?<span>Know exactly why.</span></h1>');
  expect(markup).toContain(
    "<p>Flakey brings automated runs, manual checks, and every piece of evidence into one calm release signal.</p>",
  );
  expect(markup).not.toContain("Know if you can ship.");
});
