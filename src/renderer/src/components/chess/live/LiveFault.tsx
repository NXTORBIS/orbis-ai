import type { ReactNode } from 'react'
import { faultWords, type LiveAnswer } from '../../../../../shared/chess/liveView'

/**
 * A fault, said in the provider's own words and then in ours.
 *
 * It exists because the three screens of this area all have to show the same thing and the temptation in each of
 * them is to shorten it to "could not load". The reason a provider gave is the only part of this a person can act
 * on -- "asked for fewer requests" means wait, "answered 404" means the round is gone, and a changed shape means
 * Orbis is wrong and no amount of pressing the button will help -- so the reason is always shown, verbatim, and
 * the second line says what happens now.
 */
export interface LiveFaultProps {
  fault: Extract<LiveAnswer<unknown>, { ok: false }>
  /** What was being asked for, in plain words: "the list of broadcasts", "this round". */
  about: string
  /** A way to ask again. Left out when asking again is not the answer. */
  action?: ReactNode
}

export function LiveFault({ fault, about, action }: LiveFaultProps): React.JSX.Element {
  const words = faultWords(fault)
  return (
    <div className="cw-live-fault" role="alert">
      <p className="cw-live-fault-what">
        <span className="cw-live-fault-about">{about} could not be fetched.</span> {words.what}
      </p>
      <p className="cw-live-fault-next">{words.next}</p>
      {fault.operation && <p className="cw-live-fault-where">While asking for: {fault.operation}.</p>}
      {/* A retry offered during a cooling-off period would be a control that makes things worse. */}
      {action && !words.wait ? <div className="cw-live-fault-do">{action}</div> : null}
    </div>
  )
}
