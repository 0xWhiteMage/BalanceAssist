# Bounded Commitment Sanitizer Design

## Goal

Close the remaining provider-commitment gaps without treating user-attributed pricing or non-committal language as Balance commitments.

## Design

The sanitizer will split replies into commitment clauses at sentence boundaries and contrast separators (`but`, `however`, and semicolons). It will inspect each clause for direct `price`, `fee`, or `cost` statements using `is`, `will be`, `comes to`, `totals`, or `equals` followed by a currency amount. Attribution suppresses a match only within the same clause, so attribution in an earlier clause cannot hide a later provider commitment. Inline forms such as `cost you entered is` do not match the direct-price grammar.

The timing classifier will normalize curly apostrophes and recognize `we'll`, `we can`, or `we will have it`, `the film`, `the video`, or `the project` ready when followed by a concrete date or duration. It will not match `ready` language without a concrete time expression.

## Testing

Regression tests will first demonstrate failures for each direct-price verb, curly-apostrophe `we'll`, and attribution followed by a contrasting commitment clause. Precision tests will preserve the existing inline and same-clause attribution forms, `price is expressed in dollars`, and `have it ready for discussion`. Focused sanitizer tests will establish RED and GREEN states, followed by the affected conversation and API suites, TypeScript, lint, and diff checks.
