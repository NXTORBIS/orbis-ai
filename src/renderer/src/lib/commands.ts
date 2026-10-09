export interface SlashCommand {
  name: string
  description: string
  /** What goes after the command, e.g. "/rename <new title>"; commands without it run straight away. */
  args?: string
  /** The command also runs with nothing after it: "/create" opens the screen, "/create a budget" makes one. */
  argsOptional?: boolean
}

/** Everything the message box's "/" menu offers, in the order it lists them. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'Start a new chat' },
  { name: 'clear', description: 'Clear every message in this chat' },
  { name: 'imagine', description: 'Generate an image', args: 'description' },
  { name: 'create', description: 'Make a table, a document or a flowchart, e.g. /create a weekly meal plan', args: 'what to make', argsOptional: true },
  { name: 'browse', description: 'Have Orbis do something in the browser', args: 'task' },
  { name: 'web', description: 'Turn web search on or off' },
  { name: 'model', description: 'Switch model, e.g. /model max', args: 'model' },
  { name: 'models', description: 'Choose a model from the list' },
  { name: 'regenerate', description: 'Write the last reply again' },
  { name: 'stop', description: 'Stop the reply in progress' },
  { name: 'copy', description: 'Copy the last reply' },
  { name: 'courses', description: 'Open Courses, or go to what you were learning' },
  { name: 'summarize', description: 'Summarize this chat' },
  { name: 'translate', description: 'Translate the last reply, e.g. /translate French', args: 'language' },
  { name: 'rename', description: 'Rename this chat', args: 'new title' },
  { name: 'share', description: 'Copy this chat as Markdown' },
  { name: 'delete', description: 'Delete this chat' },
  { name: 'incognito', description: 'Start or leave an incognito chat' },
  { name: 'search', description: 'Search your chats' },
  { name: 'images', description: 'Open your generated images' },
  { name: 'study', description: 'Open Orbis Student' },
  { name: 'focus', description: 'Start a focus session, e.g. /focus 25', args: 'minutes', argsOptional: true },
  { name: 'browser', description: 'Open or close the browser' },
  { name: 'theme', description: 'Switch between dark and light mode' },
  { name: 'settings', description: 'Open settings' },
  { name: 'shortcuts', description: 'Show commands and keyboard shortcuts' },
  { name: 'help', description: 'Show all commands' }
]
