import { useEffect, useState } from 'react'
import { Bluetooth, Cable, Usb, X } from 'lucide-react'
import type { DeviceKind, DeviceRequest } from '../../../shared/types'

/**
 * A site asking to use a device you have plugged in. The list comes from Chromium; Orbis only shows it and sends back
 * whichever one you pick. Saying no, closing the chooser or pressing Escape all mean the same thing: the site is told
 * that nothing was chosen, which is what it expects.
 */

const ICONS: Record<DeviceKind, typeof Usb> = { usb: Usb, hid: Cable, serial: Cable, bluetooth: Bluetooth }

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export default function DeviceChooser({ request, onAnswer }: { request: DeviceRequest; onAnswer(deviceId: string | null): void }): React.JSX.Element {
  const [chosen, setChosen] = useState<string | null>(request.devices[0]?.id ?? null)
  const Icon = ICONS[request.kind] ?? Usb

  // A device can appear or disappear while the chooser is open; whatever was picked may no longer be there.
  useEffect(() => {
    if (chosen && !request.devices.some((d) => d.id === chosen)) setChosen(request.devices[0]?.id ?? null)
  }, [request.devices, chosen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAnswer(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAnswer])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onAnswer(null)}>
      <div className="modal glass device-modal" role="dialog" aria-modal="true" aria-labelledby="device-title">
        <div className="modal-header">
          <h2 id="device-title">
            <Icon size={15} aria-hidden="true" /> Choose a device
          </h2>
          <button className="icon-btn" title="Cancel" aria-label="Cancel" onClick={() => onAnswer(null)}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p className="view-muted device-intro">
            <b>{hostOf(request.origin)}</b> wants to {request.label}. It can only use the one you choose, and only until you close Orbis.
          </p>

          {request.devices.length === 0 ? (
            <p className="view-muted device-empty">Nothing was found. Check the device is plugged in and switched on, then try again on the page.</p>
          ) : (
            <ul className="device-list" role="radiogroup" aria-label="Devices found">
              {request.devices.map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen === device.id}
                    className={`device-item${chosen === device.id ? ' on' : ''}`}
                    onClick={() => setChosen(device.id)}
                    onDoubleClick={() => onAnswer(device.id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="device-text">
                      <b>{device.name}</b>
                      {device.detail && <small className="view-muted">{device.detail}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="device-actions">
            <button type="button" className="queue-btn" onClick={() => onAnswer(null)}>
              Not now
            </button>
            <button type="button" className="queue-btn primary" disabled={!chosen} onClick={() => chosen && onAnswer(chosen)}>
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
