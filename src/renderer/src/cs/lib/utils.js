import { clsx } from "clsx"
import { twMerge } from "../ui/shadcn.jsx"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;
