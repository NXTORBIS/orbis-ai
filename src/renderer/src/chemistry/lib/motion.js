import { useEffect, useState } from 'react';

/**
 * Shared, meaningful animation system for the Jarvis app.
 * - Respects prefers-reduced-motion (accessibility).
 * - Infinite loops only where they improve feedback/immersion.
 * - Variants are small and composable; consumers pass transitions.
 */

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduce;
}

/** Soft entrance used by most content blocks. */
export const fadeUp = {
  initial: { opacity: 0, y: 14 },
  in: { opacity: 1, y: 0 },
};

/** Page-level transition (subtle slide + blur). */
export const pageVariants = {
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  in: { opacity: 1, y: 0, filter: 'blur(0px)' },
  out: { opacity: 0, y: -8, filter: 'blur(4px)' },
};

/** Stagger children for lists/grids so items reveal in sequence. */
export const staggerContainer = (stagger = 0.05, delayChildren = 0.04) => ({
  initial: {},
  in: { transition: { staggerChildren: stagger, delayChildren } },
});

/** Child item for use inside a staggerContainer. */
export const staggerItem = {
  initial: { opacity: 0, y: 16 },
  in: { opacity: 1, y: 0 },
};

/** Card lift on hover — communicates interactivity. */
export const cardHover = {
  rest: { y: 0, scale: 1 },
  hover: { y: -4, scale: 1.02, transition: { type: 'spring', stiffness: 320, damping: 22 } },
};

/** Continuous breathing for AI orbs / focal elements. */
export const breathing = {
  animate: {
    scale: [1, 1.05, 1],
    opacity: [0.85, 1, 0.85],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

/** Pulsing glow ring — used on active/selected states. */
export const pulseGlow = (color = 'hsl(189 100% 50%)') => ({
  animate: {
    boxShadow: [
      `0 0 0px ${color}00`,
      `0 0 18px ${color}66`,
      `0 0 0px ${color}00`,
    ],
    transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
  },
});

/** Springy entrance for badges, toasts, success states. */
export const bounceIn = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 500, damping: 16 } },
};

/** Indeterminate thinking animation (three dots). */
export const thinkingDots = {
  animate: { opacity: [0.2, 1, 0.2], transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } },
};

/** Helper: returns a transition object, or instant when reduced motion is on. */
export const softTransition = (reduce, duration = 0.28) =>
  reduce ? { duration: 0 } : { duration, ease: 'easeInOut' };

/** Helper: returns a loop transition, or disabled when reduced motion is on. */
export const loopTransition = (reduce, duration = 4) =>
  reduce ? { duration: 0, repeat: 0 } : { duration, repeat: Infinity, ease: 'easeInOut' };