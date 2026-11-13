// Pure comparison core for the ruleset-drift checker (postguard-js#274). No
// network, no fs — see ../ruleset-drift.mjs for the thin CLI that reads
// .github/required-rules.json, fetches the live ruleset, and calls
// `compareRules` below, and ../../tests/ruleset-drift.test.ts for the offline
// self-test that exercises it with hand-written fixtures.
//
// Exit contract, mirrored by the CLI and by scripts/ruleset-drift.sh in
// encryption4all/postguard:
//
//   0  the live rules require exactly the expected contexts and at least the
//      expected review count
//   1  DRIFT: a context is missing or unexpectedly present, or the review
//      count is lower than expected
//   2  UNDETERMINED: the live rules could not be read or made no sense — the
//      API was unreachable, answered non-200, or the parsed body isn't the
//      shape a rules-branches-main response takes. NOT drift: reporting this
//      as 1 would send someone to edit a ruleset that is probably correct,
//      and reporting real drift as this would hide a real hole.

/**
 * @param {{ contexts: string[], requiredApprovingReviewCount: number }} expected
 *   the parsed contents of `.github/required-rules.json`
 * @param {unknown} effectiveRules the parsed JSON body of
 *   `GET /repos/{owner}/{repo}/rules/branches/main`
 * @returns {{ code: 0 | 1 | 2, report: string }}
 */
export function compareRules(expected, effectiveRules) {
  if (!Array.isArray(effectiveRules)) {
    return {
      code: 2,
      report:
        'ruleset-drift: could not read the live rules — expected an array from ' +
        `rules/branches/main, got ${typeof effectiveRules}.`,
    };
  }

  // A real `main` here carries eighteen required contexts today, so a live read
  // of zero rules is far more likely a wrong branch, wrong repo, or a
  // half-read response than every rule having been deleted at once. Treating
  // it as undetermined keeps that failure mode from paging someone to fix a
  // ruleset that was never actually read.
  if (effectiveRules.length === 0) {
    return {
      code: 2,
      report:
        'ruleset-drift: the live rules array was empty — main is expected to carry rules ' +
        'today, so this looks like a misdirected read rather than an intentionally empty ' +
        'ruleset.',
    };
  }

  const statusCheckRules = effectiveRules.filter((rule) => rule?.type === 'required_status_checks');
  const pullRequestRules = effectiveRules.filter((rule) => rule?.type === 'pull_request');

  const liveContexts = new Set(
    statusCheckRules.flatMap(
      (rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []
    )
  );
  const expectedContexts = new Set(expected.contexts);

  const missing = expected.contexts.filter((context) => !liveContexts.has(context)).sort();
  const unexpected = [...liveContexts].filter((context) => !expectedContexts.has(context)).sort();

  // The floor is the best of however many `pull_request` rules apply; zero
  // such rules floors at 0, which is drift exactly like a rule that says 0.
  const liveReviewCount = pullRequestRules.reduce(
    (max, rule) => Math.max(max, rule.parameters?.required_approving_review_count ?? 0),
    0
  );
  const reviewCountDeficient = liveReviewCount < expected.requiredApprovingReviewCount;

  const findings = [];
  if (missing.length > 0) {
    findings.push(`missing required contexts: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    findings.push(`unexpected required contexts: ${unexpected.join(', ')}`);
  }
  if (reviewCountDeficient) {
    findings.push(
      `required approving review count is ${liveReviewCount}, expected at least ` +
        `${expected.requiredApprovingReviewCount}`
    );
  }

  if (findings.length === 0) {
    return {
      code: 0,
      report:
        `ruleset-drift: main requires exactly the expected ${expected.contexts.length} ` +
        `contexts and at least ${expected.requiredApprovingReviewCount} approving review(s).`,
    };
  }

  return {
    code: 1,
    report: [
      "ruleset-drift: main's required rules have drifted from .github/required-rules.json:",
      ...findings.map((finding) => `  - ${finding}`),
    ].join('\n'),
  };
}
