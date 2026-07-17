# Bounded Commitment Sanitizer Design

## Goal

Close the remaining provider-commitment gaps without treating user-attributed pricing or non-committal language as Balance commitments.

## Design

The sanitizer will inspect each reply sentence for direct `price`, `fee`, or `cost` statements containing a currency amount. A matching sentence will trigger the pricing override unless that same sentence contains an explicit user-attribution marker: `you entered`, `you stated`, `your budget`, or `client-provided`. Keeping the exception sentence-local prevents attribution elsewhere in the reply from suppressing a prohibited claim.

The timing classifier will also recognize `we can` or `we will have it`, `the film`, `the video`, or `the project` ready when followed by a concrete date or duration. It will not match `ready` language without a concrete time expression.

## Testing

Regression tests will first demonstrate failures for direct unqualified pricing and bounded ready commitments. Precision tests will preserve the explicit attribution forms, `price is expressed in dollars`, and `have it ready for discussion`. Focused sanitizer tests will establish RED and GREEN states, followed by the affected conversation and API suites, TypeScript, lint, and diff checks.
