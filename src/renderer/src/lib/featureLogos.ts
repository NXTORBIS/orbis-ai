/**
 * The logo of each feature, for the rows that show it.
 *
 * One file per feature, in src/renderer/src/assets/feature-logos, copied from orbis-ui/feature-logos. Each file is the
 * Orbis ring with the feature's own emblem and name, so a row that shows it needs no text beside it.
 */
import createLogo from '../assets/feature-logos/create.svg'
import chessLogo from '../assets/feature-logos/chess.svg'
import neurovaLogo from '../assets/feature-logos/neurova.svg'
import pagesLogo from '../assets/feature-logos/pages.svg'
import labsLogo from '../assets/feature-logos/labs.svg'
import marketsLogo from '../assets/feature-logos/markets.svg'
import whiteboardLogo from '../assets/feature-logos/whiteboard.svg'
import clipboardLogo from '../assets/feature-logos/clipboard.svg'
import workspacesLogo from '../assets/feature-logos/workspaces.svg'
import schedulesLogo from '../assets/feature-logos/schedules.svg'
import notesLogo from '../assets/feature-logos/notes.svg'
import studentLogo from '../assets/feature-logos/student.svg'
import coursesLogo from '../assets/feature-logos/courses.svg'
import toolkitLogo from '../assets/feature-logos/toolkit.svg'
import eyeLogo from '../assets/feature-logos/eye.svg'
import cosmosLogo from '../assets/feature-logos/cosmos.svg'
import f1Logo from '../assets/feature-logos/f1.svg'
import arenaLogo from '../assets/feature-logos/arena.svg'
import footballLogo from '../assets/feature-logos/football.svg'
import arcadeLogo from '../assets/feature-logos/arcade.svg'

/** A logo for every feature the app has, keyed by the feature's id. */
export const FEATURE_LOGOS: Readonly<Record<string, string>> = {
  create: createLogo,
  chess: chessLogo,
  neurova: neurovaLogo,
  pages: pagesLogo,
  labs: labsLogo,
  markets: marketsLogo,
  whiteboard: whiteboardLogo,
  clipboard: clipboardLogo,
  workspaces: workspacesLogo,
  schedules: schedulesLogo,
  notes: notesLogo,
  student: studentLogo,
  courses: coursesLogo,
  toolkit: toolkitLogo,
  eye: eyeLogo,
  cosmos: cosmosLogo,
  f1: f1Logo,
  arena: arenaLogo,
  football: footballLogo,
  arcade: arcadeLogo,
}
