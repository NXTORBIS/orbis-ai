import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/glass.css';
import { App } from './App';
import { installTooltipPlacement } from './ui/tooltips';
import { installRadioGroupKeys } from './ui/keyboard';

installRadioGroupKeys();

class Boundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="boot">
          <div className="state state-error" role="alert">
            <h3>Something went wrong in the interface</h3>
            <p>{this.state.error.message}</p>
            <p className="muted">Your files were not affected. Reload the window to continue.</p>
            <button type="button" className="btn btn-primary btn-md" onClick={() => location.reload()}>Reload window</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

installTooltipPlacement();

createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
