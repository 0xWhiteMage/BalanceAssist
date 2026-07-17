# Bounded Commitment Sanitizer Design

## Goal

Close the remaining provider-commitment gaps without treating user-attributed pricing or non-committal language as Balance commitments.

## Design

The sanitizer will find every direct `price`, `fee`, or `cost` assertion using `is`, `will be`, `comes to`, `totals`, or `equals` followed by a numeric or spelled-out money amount. It will exempt a match only when attribution is immediately attached to that matched subject, such as `you stated the fee`, `your stated fee`, or `client-provided fee`. Unrelated attribution elsewhere cannot suppress the assertion, and interrupted forms such as `cost you entered is` do not match the direct-price grammar. This removes dependency on enumerating sentence or clause connectors.

The timing classifier will normalize curly apostrophes and recognize `we'll`, `we can`, or `we will have it`, `the film`, `the video`, or `the project` ready when followed by a concrete date or duration. It will not match `ready` language without a concrete time expression.

## Testing

Regression tests will first demonstrate failures for the review's five exact direct-assertion cases, including spelled-out money. Precision tests will preserve subject-local and interrupted attribution forms, `price is expressed in dollars`, and `have it ready for discussion`. Focused sanitizer tests will establish RED and GREEN states, followed by the affected conversation and API suites, TypeScript, lint, and diff checks.
