import { useEffect, useMemo } from 'react'
import type { F1Answer, F1Session } from '../../../../shared/f1/types'
import { Waiting, useF1 } from './shared'

/**
 * Chooses one finished session of a year. Sessions come from OpenF1, whose free data begins in 2023; the label says
 * where and what, and the newest finished session is selected until the person chooses another.
 */
export function SessionPicker({
  year,
  value,
  onChange,
  only
}: {
  year: number
  value: F1Session | null
  onChange: (s: F1Session | null) => void
  /** Restrict to some session names, e.g. ['Race', 'Sprint']. */
  only?: string[]
}): React.JSX.Element {
  const [load, retry] = useF1<F1Session[]>(() => window.api.f1Sessions(year) as Promise<F1Answer<F1Session[]>>, [year])
  const finished = useMemo(
    () =>
      load.state === 'ready'
        ? load.answer.data
            .filter((s) => Date.parse(s.endsAt) < Date.now() && (!only || only.includes(s.name)))
            .slice()
            .reverse()
        : [],
    [load, only]
  )
  useEffect(() => {
    if (load.state !== 'ready') return
    if (!value || !finished.some((s) => s.key === value.key)) onChange(finished[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what={`the ${year} sessions`} />
  if (finished.length === 0) return <p className="f1-note">No finished session was found for {year}.</p>
  return (
    <label className="f1-pickrow">
      Session
      <select
        value={value?.key ?? ''}
        onChange={(e) => onChange(finished.find((s) => s.key === Number(e.target.value)) ?? null)}
      >
        {finished.map((s) => (
          <option key={s.key} value={s.key}>
            {s.circuitName} · {s.name} · {new Date(s.startsAt).toLocaleDateString()}
          </option>
        ))}
      </select>
    </label>
  )
}
