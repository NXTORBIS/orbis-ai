import { isVisible, type VisibilityChoice } from '../../../shared/featureVisibility.ts'

export interface SlashCommand {
  name: string
  description: string
  /**
   * The screen this command opens, when it opens one.
   *
   * People choose which screens are in their menu, and a command is a way into a screen like any other. This is what
   * lets a list of commands leave out the ones that would land on a screen somebody switched off.
   */
  feature?: string
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
  { name: 'create', description: 'Make a table, a document or a flowchart, e.g. /create a weekly meal plan', args: 'what to make', argsOptional: true, feature: 'create' },
  { name: 'browse', description: 'Have Orbis do something in the browser', args: 'task' },
  { name: 'web', description: 'Turn web search on or off' },
  { name: 'model', description: 'Switch model, e.g. /model max', args: 'model' },
  { name: 'models', description: 'Choose a model from the list' },
  { name: 'regenerate', description: 'Write the last reply again' },
  { name: 'stop', description: 'Stop the reply in progress' },
  { name: 'copy', description: 'Copy the last reply' },
  { name: 'courses', description: 'Open Courses, or go to what you were learning', feature: 'courses' },
  { name: 'toolkit', description: 'Open the Toolkit: calculators, converters and lab tools', feature: 'toolkit' },
  { name: 'arena', description: 'Open the Arena: live football, Formula 1 and more', feature: 'arena' },
  { name: 'football', description: 'Open Football: live scores, fixtures and tables', feature: 'football' },
  { name: 'f1', description: 'Open F1: Orbis Arena’s Formula 1 intelligence', feature: 'f1' },
  { name: 'arcade', description: 'Open the Arcade: games that need no connection', feature: 'arcade' },
  { name: 'cosmos', description: 'Open ORBIS COSMOS: the real-time 3D universe', feature: 'cosmos' },
  { name: 'eye', description: 'Open OrbisEye: the live 3D Earth', feature: 'eye' },
  { name: 'summarize', description: 'Summarize this chat' },
  { name: 'translate', description: 'Translate the last reply, e.g. /translate French', args: 'language' },
  { name: 'rename', description: 'Rename this chat', args: 'new title' },
  { name: 'share', description: 'Copy this chat as Markdown' },
  { name: 'delete', description: 'Delete this chat' },
  { name: 'incognito', description: 'Start or leave an incognito chat' },
  { name: 'search', description: 'Search your chats' },
  { name: 'images', description: 'Open your generated images' },
  { name: 'study', description: 'Open Orbis Student', feature: 'student' },
  { name: 'focus', description: 'Start a focus session, e.g. /focus 25', args: 'minutes', argsOptional: true, feature: 'student' },
  { name: 'browser', description: 'Open or close the browser' },
  { name: 'theme', description: 'Switch between dark and light mode' },
  { name: 'settings', description: 'Open settings' },
  { name: 'shortcuts', description: 'Show commands and keyboard shortcuts' },
  { name: 'help', description: 'Show all commands' }
]

/**
 * The commands worth listing to this person.
 *
 * A **list** of what you can do leaves out the screens somebody switched off, the same way their menu does -- an
 * advertised command that lands on a hidden screen is the "never claim a thing is on when it is off" rule broken in
 * print.
 *
 * The "/" menu in the message box is deliberately **not** filtered with this. That menu is a search: you type "/cos"
 * and it narrows, which is how somebody finds a thing they did not pick -- exactly like the Ctrl+K box, which also
 * finds switched-off screens on purpose. Typing one of them still never lies: `App.tsx` runs every command through
 * the one guard, which says the screen is switched off and how to turn it on rather than failing quietly.
 */
export const slashCommandsFor = (choice: VisibilityChoice | null): readonly SlashCommand[] =>
  SLASH_COMMANDS.filter((one) => one.feature === undefined || isVisible(one.feature, choice))
