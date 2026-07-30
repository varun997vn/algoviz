import type { ProblemDefinition } from '@algoviz/problems';
import { type ReactNode } from 'react';
/**
 * In test mode the player's clock is driven by hand and animations are off, so UI tests can
 * `seek(n)` and assert immediately instead of racing a timer. Set by Playwright's init script.
 */
declare global {
    interface Window {
        __ALGOVIZ_TEST__?: boolean;
        __algoviz?: {
            seek(frame: number): void;
            advance(ms: number): void;
            frameCount(): number;
        };
    }
}
export declare function Workbench({ problem, initialCase, storageKey, }: {
    problem: ProblemDefinition;
    initialCase: number;
    storageKey: string;
}): ReactNode;
//# sourceMappingURL=Workbench.d.ts.map