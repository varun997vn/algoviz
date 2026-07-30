import { type ReactNode } from 'react';
export interface CodeEditorProps {
    value: string;
    onChange(next: string): void;
    highlightLine?: number | undefined;
    errorLine?: number | undefined;
}
export declare function CodeEditor({ value, onChange, highlightLine, errorLine }: CodeEditorProps): ReactNode;
//# sourceMappingURL=CodeEditor.d.ts.map