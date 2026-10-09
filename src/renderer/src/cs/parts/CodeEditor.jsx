import React, { useRef } from 'react';
import Editor from '../ui/monaco.jsx';

// Reusable Monaco wrapper for the Computer Science Studio.
// Professional defaults: syntax highlighting, minimap, bracket matching, etc.
export default function CodeEditor({ value, language, onChange, theme = 'vs-dark', height = '100%', readOnly = false }) {
  const editorRef = useRef(null);

  const handleMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <div className="h-full w-full min-h-0">
      <Editor
        height={height}
        language={language || 'plaintext'}
        value={value ?? ''}
        theme={theme}
        onMount={handleMount}
        onChange={(val) => onChange?.(val ?? '')}
        loading={<div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading editor…</div>}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          minimap: { enabled: true },
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: 4,
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: true,
          suggestOnTriggerCharacters: true,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          padding: { top: 8, bottom: 8 },
          readOnly,
          domReadOnly: readOnly,
        }}
      />
    </div>
  );
}