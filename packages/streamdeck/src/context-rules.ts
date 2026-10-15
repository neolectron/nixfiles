import type { ContextRule } from './studio-contract.ts';
export type Rule = ContextRule;
export const select = (rules: ReadonlyArray<Rule>, application: string | null): Rule | undefined =>
  rules
    .filter(
      (rule) =>
        application &&
        rule.applications.some((id) => id.toLowerCase() === application.toLowerCase()),
    )
    .toSorted((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
