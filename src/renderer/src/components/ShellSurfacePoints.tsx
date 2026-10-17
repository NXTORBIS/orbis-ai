import { useSurface } from '../lib/surfaces'
import { chatSurface, shellSurface, type ChatScreen, type ShellScreen } from './shellSurfaces'

/**
 * Where the Orbis window says what can be done to it.
 *
 * Draws nothing at all. It exists because `useSurface` is a hook: the window itself is always there, and the
 * conversation is only sometimes the thing in front of somebody -- it stays mounted while a module draws over it --
 * so the conversation's registration has to be a component that is mounted with it and unmounted with it.
 *
 * Without that, Orbis would be told the conversation was on screen while Chess World covered it, and would set the
 * model on something nobody was looking at.
 */
export default function ShellSurfacePoints({ shell, chat }: { shell: ShellScreen; chat: ChatScreen | null }): React.JSX.Element | null {
  useSurface(shellSurface(shell))
  return chat ? <ChatSurfacePoint chat={chat} /> : null
}

function ChatSurfacePoint({ chat }: { chat: ChatScreen }): null {
  useSurface(chatSurface(chat))
  return null
}
