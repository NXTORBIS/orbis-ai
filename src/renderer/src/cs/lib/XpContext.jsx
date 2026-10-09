import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '../api/base44Client.js';
import { levelFromXp, titleForLevel } from './xpLevels.js';
import { audioEngine } from './AudioEngine.js';

const XpContext = createContext(null);

export function useXp() {
  const ctx = useContext(XpContext);
  return ctx || {
    status: null, loading: true,
    award: async () => ({}),
    refresh: async () => {},
    pendingGain: null,
    dismissGain: () => {},
  };
}

const SOURCE_LABELS = {
  course: 'Course', task: 'Task', reminder: 'Reminder', chat: 'Chat',
  project: 'Project', practice: 'Practice', studio: 'Studio',
  achievement: 'Achievement', streak: 'Streak', goal: 'Goal', challenge: 'Challenge',
};

export function XpProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingGain, setPendingGain] = useState(null);
  const gainQueue = useRef([]);
  const draining = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('awardXp', { action: 'status' });
      const data = res?.data ?? res;
      setStatus(data);
      return data;
    } catch (e) {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Real-time: refresh when a new XP transaction lands for this user.
  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = base44.entities.XpTransaction.subscribe(() => { refresh(); });
    } catch (e) {}
    return () => unsub();
  }, [refresh]);

  const pushGain = useCallback((gain) => {
    gainQueue.current.push(gain);
    const drain = () => {
      if (draining.current) return;
      draining.current = true;
      const next = gainQueue.current.shift();
      if (!next) { draining.current = false; return; }
      setPendingGain(next);
      setTimeout(() => {
        setPendingGain(null);
        draining.current = false;
        setTimeout(drain, 250);
      }, 3200);
    };
    drain();
  }, []);

  const dismissGain = useCallback(() => {
    setPendingGain(null);
    draining.current = false;
  }, []);

  // The single, authoritative way to award XP across the whole platform.
  const award = useCallback(async (params) => {
    try {
      const res = await base44.functions.invoke('awardXp', {
        action: 'award',
        source: params.source,
        activity_type: params.activity_type,
        ref_id: params.ref_id || null,
        description: params.description || '',
        difficulty: params.difficulty || 'standard',
        metadata: params.metadata || {},
      });
      const data = res?.data ?? res;
      if (data?.awarded) {
        pushGain({
          amount: data.amount,
          label: SOURCE_LABELS[params.source] || params.source,
          description: params.description || '',
          leveledUp: data.leveled_up,
          newLevel: data.level,
          newTitle: data.title,
          bonus: data.bonus_achievements || [],
        });
        audioEngine.xp(data.amount);
        if (data.leveled_up) audioEngine.levelUp();
        // Optimistically update status from the response so the navbar moves immediately.
        setStatus((prev) => prev ? {
          ...prev,
          total_xp: data.total_xp,
          level: data.level,
          title: data.title,
          progress: data.progress,
          xp_to_next: data.xp_to_next,
          streak_days: data.streak,
          daily_xp: data.daily_xp,
          weekly_xp: data.weekly_xp,
        } : prev);
      }
      return data;
    } catch (e) {
      return { awarded: false, error: e.message };
    }
  }, [pushGain]);

  const setGoal = useCallback(async (patch) => {
    try {
      await base44.functions.invoke('awardXp', { action: 'setGoal', ...patch });
      await refresh();
    } catch (e) {}
  }, [refresh]);

  const value = {
    status,
    loading,
    level: status ? status.level : 1,
    totalXp: status ? status.total_xp : 0,
    title: status ? status.title : 'Initiate',
    progress: status ? status.progress : 0,
    xpToNext: status ? status.xp_to_next : 0,
    streak: status ? status.streak_days : 0,
    award,
    setGoal,
    refresh,
    pendingGain,
    dismissGain,
  };

  return <XpContext.Provider value={value}>{children}</XpContext.Provider>;
}