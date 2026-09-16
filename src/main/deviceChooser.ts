import { webContents } from 'electron'
import type { Session, WebContents } from 'electron'
import crypto from 'node:crypto'
import type { DeviceRequest, DeviceKind } from '../shared/types'

/**
 * Choosing a device for a page.
 *
 * A site that wants a USB, HID, serial or Bluetooth device asks the browser, and the browser asks you: Chromium hands
 * the list to the app and waits. Without this, every such request is refused with "no device selected" and the site
 * looks broken for no visible reason — which is exactly what Orbis did before.
 *
 * Nothing is granted on its own. A device a site may use is one you picked for it, and that choice lasts for as long as
 * Orbis is open: nothing about your hardware is written to disk, and the next time Orbis starts the site asks again.
 */

const KIND_WORDS: Record<DeviceKind, string> = {
  usb: 'connect to a USB device',
  hid: 'use a device you plug in',
  serial: 'use a serial port',
  bluetooth: 'connect to a Bluetooth device'
}

/** What to call a device on screen: whatever it tells us about itself, then a plainer description of its numbers. */
export function deviceName(kind: DeviceKind, device: Record<string, unknown>): string {
  const named = [device.deviceName, device.productName, device.name, device.portName, device.displayName].find((n) => typeof n === 'string' && n.trim())
  if (typeof named === 'string' && named.trim()) return named.trim().slice(0, 80)
  if (kind === 'serial') {
    const port = [device.portId, device.path].find((p) => typeof p === 'string')
    return typeof port === 'string' ? `Serial port ${port}`.slice(0, 80) : 'A serial port'
  }
  const vendor = typeof device.vendorId === 'number' ? device.vendorId.toString(16).padStart(4, '0') : null
  const product = typeof device.productId === 'number' ? device.productId.toString(16).padStart(4, '0') : null
  if (vendor && product) return `Device ${vendor}:${product}`
  return kind === 'bluetooth' ? 'An unnamed Bluetooth device' : 'An unnamed device'
}

/** Extra wording for the chooser: who made it, where it is plugged in. Empty when the device says nothing useful. */
export function deviceDetail(kind: DeviceKind, device: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof device.manufacturerName === 'string' && device.manufacturerName.trim()) parts.push(device.manufacturerName.trim())
  if (typeof device.serialNumber === 'string' && device.serialNumber.trim()) parts.push(`serial ${device.serialNumber.trim()}`)
  if (kind === 'serial' && typeof device.path === 'string') parts.push(device.path)
  return parts.join(' · ').slice(0, 120)
}

/** The id Chromium uses for a device, whichever kind it is. */
const idOf = (kind: DeviceKind, device: Record<string, unknown>): string => {
  const id = kind === 'serial' ? device.portId : kind === 'bluetooth' ? device.deviceId : device.deviceId
  return typeof id === 'string' ? id : ''
}

/** Remembers what a site may reach, for as long as Orbis is running. */
const grantKey = (origin: string, kind: DeviceKind, device: Record<string, unknown>): string => `${origin}|${kind}|${idOf(kind, device)}`

export interface DeviceChooserOptions {
  /** Shows the chooser in the Orbis window. Resolves with the chosen device's id, or null when the user says no. */
  ask(request: DeviceRequest): Promise<string | null>
  /** Only tabs in the Orbis window may show a chooser; a request from anywhere else is refused. */
  canAsk(contents: WebContents | null): boolean
}

export class DeviceChooser {
  private readonly o: DeviceChooserOptions
  /** Devices the user has picked, for this run of Orbis only. */
  private readonly granted = new Set<string>()

  constructor(options: DeviceChooserOptions) {
    this.o = options
  }

  /** Forgets everything that was picked — used when the user clears what sites may do. */
  forget(): void {
    this.granted.clear()
  }

  /** Asks the window, remembers what was picked, and answers Chromium. An empty answer cancels the request. */
  private async choose(
    kind: DeviceKind,
    origin: string,
    devices: Record<string, unknown>[],
    allowed: boolean,
    reply: (id: string) => void
  ): Promise<void> {
    if (!allowed || !origin) return reply('')
    const request: DeviceRequest = {
      id: crypto.randomUUID(),
      origin,
      kind,
      label: KIND_WORDS[kind],
      devices: devices.map((device) => ({ id: idOf(kind, device), name: deviceName(kind, device), detail: deviceDetail(kind, device) })).filter((d) => d.id)
    }
    const chosen = await this.o.ask(request).catch(() => null)
    if (!chosen) return reply('')
    const device = devices.find((d) => idOf(kind, d) === chosen)
    if (device) this.granted.add(grantKey(origin, kind, device))
    reply(chosen)
  }

  /**
   * Wires one session: USB, HID and serial requests all arrive here, and a site may only use a device it was given.
   * Chromium asks permission every time a page touches a device, so one that was never chosen stays out of reach even
   * if the site knows it is there.
   */
  wire(session: Session): void {
    session.setDevicePermissionHandler((details) =>
      this.granted.has(grantKey(details.origin, details.deviceType as DeviceKind, details.device as unknown as Record<string, unknown>))
    )

    session.on('select-usb-device', (event, details, callback) => {
      event.preventDefault()
      const frame = details.frame
      void this.choose('usb', originOf(frame?.url ?? ''), details.deviceList as unknown as Record<string, unknown>[], this.o.canAsk(frameOwner(frame)), callback)
    })
    session.on('select-hid-device', (event, details, callback) => {
      event.preventDefault()
      const frame = details.frame
      void this.choose('hid', originOf(frame?.url ?? ''), details.deviceList as unknown as Record<string, unknown>[], this.o.canAsk(frameOwner(frame)), callback)
    })
    session.on('select-serial-port', (event, portList, contents, callback) => {
      event.preventDefault()
      void this.choose('serial', originOf(contents?.getURL() ?? ''), portList as unknown as Record<string, unknown>[], this.o.canAsk(contents), callback)
    })
  }

  /**
   * Bluetooth is asked for per page rather than per session. Chromium fires this again as more devices are found, so
   * the first request opens the chooser and every later one is answered with whatever is already chosen.
   */
  attach(contents: WebContents): void {
    contents.on('select-bluetooth-device', (event, deviceList, callback) => {
      event.preventDefault()
      void this.choose('bluetooth', originOf(contents.getURL()), deviceList as unknown as Record<string, unknown>[], this.o.canAsk(contents), callback)
    })
  }
}

/** The page a frame belongs to, so a request can be traced back to a tab in the Orbis window. */
const frameOwner = (frame: Electron.WebFrameMain | null): WebContents | null => {
  if (!frame) return null
  try {
    return webContents.fromFrame(frame) ?? null
  } catch {
    // The frame navigated away or closed while the request was in flight.
    return null
  }
}

const originOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : ''
  } catch {
    return ''
  }
}
