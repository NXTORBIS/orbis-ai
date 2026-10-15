import React from 'react';
import { call } from '../api';
import { ErrorState } from './components';

/**
 * Contains a rendering error to one panel (a pane, the details panel, a
 * preview, a dialog…) so the rest of the window keeps working. The error is
 * logged in the main process and its reference shown; "Try again" re-mounts
 * the panel. Changing `resetKey` (e.g. a new location) also clears the error.
 */
export class PanelBoundary extends React.Component<{ label: string; resetKey?: string; onDismiss?: () => void; children: React.ReactNode }, { error?: Error; errorId?: string; key?: string }> {
  override state: { error?: Error; errorId?: string; key?: string } = { key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { key?: string; error?: Error }) {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: undefined, errorId: undefined };
    return null;
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    void call<{ errorId: string }>('diag:rendererError', { where: this.props.label, message: String(error?.message ?? error).slice(0, 2000), stack: `${error?.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 8000) })
      .then((r) => this.setState({ errorId: r.errorId }), () => undefined);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState title={`The ${this.props.label} could not be shown`} body={`${this.state.error.message || 'Unexpected error.'} Nothing on disk was changed.`} errorId={this.state.errorId}>
        <button type="button" className="btn btn-default btn-md" onClick={() => this.setState({ error: undefined, errorId: undefined })}>Try again</button>
        {this.props.onDismiss && <button type="button" className="btn btn-ghost btn-md" onClick={this.props.onDismiss}>Close</button>}
      </ErrorState>
    );
  }
}
