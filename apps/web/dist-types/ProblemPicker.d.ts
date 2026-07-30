import type { ProblemDefinition } from '@algoviz/problems';
import { type ReactNode } from 'react';
/**
 * The problem list, driven by the roadmap rather than by whatever happens to be implemented.
 *
 * Showing all 75 from the start — with the un-built ones clearly marked — is the point: the
 * roadmap is the plan, and the app is its progress bar.
 */
export declare function ProblemPicker({ problems, onSelect, }: {
    problems: readonly ProblemDefinition[];
    onSelect(problem: ProblemDefinition | null): void;
}): ReactNode;
//# sourceMappingURL=ProblemPicker.d.ts.map