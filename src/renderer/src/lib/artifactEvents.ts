/**
 * How a card in the conversation reaches the rest of the window.
 *
 * A message is memoised on its data, so a callback handed down to it would be the one from the render it was first
 * drawn in. An event on the window has no such age: whoever listens now hears it. The same way a link in a reply
 * reaches the browser (see openInBrowser.ts).
 */

/** Open one kept artifact on the Create screen. */
export const OPEN_ARTIFACT_EVENT = 'orbis:open-artifact'
/** Something kept may have changed: cards showing it read it again. No id means "any of them". */
export const ARTIFACT_CHANGED_EVENT = 'orbis:artifact-changed'

export interface OpenArtifactDetail {
  artifactId: string
}

export interface ArtifactChangedDetail {
  artifactId?: string
}

export function openArtifact(artifactId: string): void {
  window.dispatchEvent(new CustomEvent<OpenArtifactDetail>(OPEN_ARTIFACT_EVENT, { detail: { artifactId } }))
}

export function artifactChanged(artifactId?: string): void {
  window.dispatchEvent(new CustomEvent<ArtifactChangedDetail>(ARTIFACT_CHANGED_EVENT, { detail: { artifactId } }))
}
