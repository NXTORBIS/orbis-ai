export interface Persona {
  id: string
  label: string
  description: string
  /** Added to the system prompt; empty for the general assistant. */
  prompt: string
}

export const PERSONAS: Persona[] = [
  { id: 'general', label: 'General AI', description: 'Everyday questions and tasks', prompt: '' },
  {
    id: 'code',
    label: 'Code Engineer',
    description: 'Programming, debugging, architecture',
    prompt: 'Act as a senior software engineer. Prefer precise, working code with short explanations, and call out edge cases.'
  },
  {
    id: 'research',
    label: 'Research Analyst',
    description: 'Deep dives, comparisons, summaries',
    prompt: 'Act as a meticulous research analyst. Structure answers with headings and tables where helpful, and say when you are uncertain.'
  },
  {
    id: 'writer',
    label: 'Creative Writer',
    description: 'Stories, copy, and editing',
    prompt: 'Act as a skilled creative writer and editor with a vivid, clear voice.'
  }
]

export const DEFAULT_PERSONA = PERSONAS[0].id

export function personaInfo(id: string | undefined): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}
