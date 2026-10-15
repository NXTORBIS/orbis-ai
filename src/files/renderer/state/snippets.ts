import { createStore } from './store';
import type { Snippet } from '../../shared/snippets';

export interface SnippetState {
  snippets: Snippet[];
  loading: boolean;
  search: string;
  tagFilter: string | null;
}

export const snippetStore = createStore<SnippetState>({
  snippets: [],
  loading: true,
  search: '',
  tagFilter: null,
});
