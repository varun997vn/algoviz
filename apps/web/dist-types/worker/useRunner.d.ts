import type { Diagnostic, RunRequest, SerializedCaseResult } from '@algoviz/runner';
export type RunPhase = 'idle' | 'running' | 'done' | 'error';
export interface RunnerState {
    phase: RunPhase;
    results: SerializedCaseResult[];
    diagnostics: Diagnostic[];
    passed: boolean | undefined;
    failure: string | undefined;
    run(request: RunRequest): void;
    cancel(): void;
}
export declare function useRunner(): RunnerState;
//# sourceMappingURL=useRunner.d.ts.map