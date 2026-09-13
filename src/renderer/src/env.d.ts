/// <reference types="vite/client" />
import type { NxtorbisApi } from '../../shared/types'

declare global {
  interface Window {
    api: NxtorbisApi
  }
}
