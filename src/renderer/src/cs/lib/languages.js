// Language registry for the Computer Science Studio.
//
// CHANGED FROM THEIRS: their version set `executionAvailable: true` on every language, because their site
// could not execute anything. Orbis can: a configured sandbox really runs the code, and otherwise Orion reads it
// and says what it would print. Reading works for any language, so nothing here is a gate any more --
// `executionAvailable` now means "something can handle this", which is true of all of them, and `canReallyRun`
// says whether a sandbox could also run it rather than read it. The screens show which happened; they no longer
// refuse.

const py = (fn = 'main') => `# ${fn}.py\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n`;
const c = (fn = 'main') => `// ${fn}.c\n#include <stdio.h>\n\nint main(void) {\n    printf("Hello Jarvis\\n");\n    return 0;\n}\n`;
const cpp = (fn = 'main') => `// ${fn}.cpp\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    cout << "Hello Jarvis\\n";\n    return 0;\n}\n`;
const java = (fn = 'Main') => `// ${fn}.java\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello Jarvis");\n    }\n}\n`;
const csharp = (fn = 'Main') => `// ${fn}.cs\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello Jarvis");\n    }\n}\n`;
const fsharp = (fn = 'Program') => `// ${fn}.fsx\nprintfn "Hello Jarvis"\n`;
const go = (fn = 'main') => `// ${fn}.go\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello Jarvis")\n}\n`;
const rust = (fn = 'main') => `// ${fn}.rs\nfn main() {\n    println!("Hello Jarvis!");\n}\n`;
const php = (fn = 'main') => `<?php\n// ${fn}.php\necho "Hello Jarvis\\n";\n`;
const ruby = (fn = 'main') => `# ${fn}.rb\nputs "Hello Jarvis"\n`;
const haskell = (fn = 'Main') => `-- ${fn}.hs\nmain :: IO ()\nmain = putStrLn "Hello Jarvis"\n`;
const ts = (fn = 'main') => `// ${fn}.ts\nconst main = (): void => {\n  console.log("Hello Jarvis");\n};\nmain();\n`;
const js = (fn = 'main') => `// ${fn}.js\nconst main = () => {\n  console.log("Hello Jarvis");\n};\nmain();\n`;

/**
 * Every language the studio offers.
 *
 * `executionAvailable` is true for all of them because Orion can read any language. `canReallyRun` is true only
 * for the ones a sandbox could compile and run, so a screen can say "read" or "ran" honestly.
 */
export const LANGUAGES = [
  { id: 'python', label: 'Python', monaco: 'python', category: 'General', executionAvailable: true, canReallyRun: true, starter: py },
  { id: 'cpp', label: 'C++', monaco: 'cpp', category: 'General', executionAvailable: true, canReallyRun: true, starter: cpp },
  { id: 'c', label: 'C', monaco: 'c', category: 'General', executionAvailable: true, canReallyRun: true, starter: c },
  { id: 'java', label: 'Java', monaco: 'java', category: 'General', executionAvailable: true, canReallyRun: true, starter: java },
  { id: 'csharp', label: 'C#', monaco: 'csharp', category: 'General', executionAvailable: true, canReallyRun: true, starter: csharp },
  { id: 'go', label: 'Go', monaco: 'go', category: 'General', executionAvailable: true, canReallyRun: true, starter: go },
  { id: 'rust', label: 'Rust', monaco: 'rust', category: 'Systems', executionAvailable: true, canReallyRun: true, starter: rust },
  { id: 'typescript', label: 'TypeScript', monaco: 'typescript', category: 'Web', executionAvailable: true, canReallyRun: true, starter: ts },
  { id: 'javascript', label: 'JavaScript', monaco: 'javascript', category: 'Web', executionAvailable: true, canReallyRun: true, starter: js },
  { id: 'fsharp', label: 'F#', monaco: 'fsharp', category: 'Functional', executionAvailable: true, canReallyRun: true, starter: fsharp },
  { id: 'haskell', label: 'Haskell', monaco: 'haskell', category: 'Functional', executionAvailable: true, canReallyRun: true, starter: haskell },
  { id: 'php', label: 'PHP', monaco: 'php', category: 'General', executionAvailable: true, canReallyRun: true, starter: php },
  { id: 'ruby', label: 'Ruby', monaco: 'ruby', category: 'General', executionAvailable: true, canReallyRun: true, starter: ruby },
];

export const LANGUAGE_CATEGORIES = ['General', 'Web', 'Functional', 'Scientific', 'Systems'];

export function getLanguage(id) {
  return LANGUAGES.find((l) => l.id === id);
}

// Per-problem starter code templates (LeetCode-style "solve" signature).
export function problemStarter(langId, signature) {
  return signature[langId] || signature.python || `// No starter for ${langId}\n`;
}