/** File template types. */

export type TemplateCategory = 'code' | 'document' | 'config' | 'web' | 'data' | 'other';

export interface FileTemplate {
  id: string;
  name: string;
  ext: string;
  category: TemplateCategory;
  content: string;
  description: string;
  icon?: string;
  /** true for user-created templates stored in KV. */
  custom?: boolean;
}
