// Real, localStorage-backed progress for the Computer Science Studio.
// No fake percentages — every number is derived from actual completed activities.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cs_studio_progress_v1';

const EMPTY = {
  solved: [],          // problem ids accepted
  attempted: [],        // problem ids submitted (any verdict)
  bookmarked: [],       // problem ids
  notes: {},            // problemId -> note text
  hintsUsed: {},        // problemId -> count
  viewedSolution: [],   // problem ids whose solution was revealed
  lessonsCompleted: [], // lesson ids
  submissions: [],      // recent submissions
  xpAwarded: {},        // key -> already awarded (anti-abuse)
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch { return { ...EMPTY }; }
}

function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function useCSProgress() {
  const [progress, setProgress] = useState(() => load());

  useEffect(() => { save(progress); }, [progress]);

  const recordSubmission = useCallback((s) => {
    setProgress((p) => {
      const submissions = [s, ...p.submissions].slice(0, 200);
      const attempted = p.attempted.includes(s.problemId) ? p.attempted : [...p.attempted, s.problemId];
      let solved = p.solved;
      let xpAwarded = p.xpAwarded;
      if (s.verdict === 'Accepted') {
        solved = p.solved.includes(s.problemId) ? p.solved : [...p.solved, s.problemId];
        xpAwarded = { ...p.xpAwarded, [`problem:${s.problemId}`]: true };
      }
      return { ...p, submissions, attempted, solved, xpAwarded };
    });
  }, []);

  const toggleBookmark = useCallback((problemId) => {
    setProgress((p) => ({
      ...p,
      bookmarked: p.bookmarked.includes(problemId)
        ? p.bookmarked.filter((x) => x !== problemId)
        : [...p.bookmarked, problemId],
    }));
  }, []);

  const setNote = useCallback((problemId, text) => {
    setProgress((p) => ({ ...p, notes: { ...p.notes, [problemId]: text } }));
  }, []);

  const useHint = useCallback((problemId) => {
    setProgress((p) => ({ ...p, hintsUsed: { ...p.hintsUsed, [problemId]: (p.hintsUsed[problemId] || 0) + 1 } }));
  }, []);

  const revealSolution = useCallback((problemId) => {
    setProgress((p) => p.viewedSolution.includes(problemId) ? p : ({ ...p, viewedSolution: [...p.viewedSolution, problemId] }));
  }, []);

  const completeLesson = useCallback((lessonId) => {
    setProgress((p) => {
      if (p.lessonsCompleted.includes(lessonId)) return p;
      return {
        ...p,
        lessonsCompleted: [...p.lessonsCompleted, lessonId],
        xpAwarded: { ...p.xpAwarded, [`lesson:${lessonId}`]: true },
      };
    });
  }, []);

  const problemStatus = useCallback((problemId) => {
    if (progress.solved.includes(problemId)) return 'Solved';
    if (progress.attempted.includes(problemId)) return 'Attempted';
    return 'Not Attempted';
  }, [progress]);

  return {
    progress,
    recordSubmission,
    toggleBookmark,
    setNote,
    useHint,
    revealSolution,
    completeLesson,
    problemStatus,
  };
}