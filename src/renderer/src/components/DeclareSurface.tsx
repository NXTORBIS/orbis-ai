import { useSurface, type SurfaceDeclaration } from '../lib/surfaces'

/**
 * Registers one screen for as long as it is rendered, and draws nothing.
 *
 * `useSurface` is a hook, so it cannot be called only sometimes -- and plenty of real screens exist only sometimes:
 * the market page while a market is open, a Page's own tool while that Page is the one in the frame. The two wrong
 * ways round it are both worse than this one line. Declaring the screen always and leaving every control unreadable
 * would have a walk arrive somewhere that is not there; declaring it with no name has it reported as a screen that
 * could not be placed, every draw, for ever.
 *
 * So: build the declaration where the state is, and render this where the screen really is. Rendered, it registers;
 * taken away, it unregisters.
 */
export default function DeclareSurface({ declaration }: { declaration: SurfaceDeclaration }): null {
  useSurface(declaration)
  return null
}
