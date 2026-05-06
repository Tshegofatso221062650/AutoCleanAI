import { useState, useCallback, useRef } from "react";

interface HistoryItem<T> {
  state: T;
  timestamp: number;
  description?: string;
}

interface UseUndoRedoOptions<T> {
  maxHistory?: number;
  onUndo?: (state: T) => void;
  onRedo?: (state: T) => void;
}

export function useUndoRedo<T>(initialState: T, options: UseUndoRedoOptions<T> = {}) {
  const { maxHistory = 50, onUndo, onRedo } = options;
  const [state, setState] = useState<T>(initialState);
  const [history, setHistory] = useState<HistoryItem<T>[]>([{ state: initialState, timestamp: Date.now() }]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const isUndoRedoOperation = useRef(false);

  const pushState = useCallback(
    (newState: T | ((prev: T) => T), description?: string) => {
      if (isUndoRedoOperation.current) {
        isUndoRedoOperation.current = false;
        return;
      }

      const computedState = typeof newState === "function" ? (newState as (prev: T) => T)(state) : newState;
      
      setHistory((prev) => {
        const newHistory = prev.slice(0, currentIndex + 1);
        newHistory.push({ state: computedState, timestamp: Date.now(), description });
        
        if (newHistory.length > maxHistory) {
          newHistory.shift();
          return newHistory;
        }
        
        return newHistory;
      });
      
      setCurrentIndex((prev) => {
        const newIndex = Math.min(prev + 1, maxHistory - 1);
        return newIndex;
      });
      
      setState(computedState);
    },
    [state, currentIndex, maxHistory],
  );

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      const previousState = history[newIndex].state;
      
      isUndoRedoOperation.current = true;
      setCurrentIndex(newIndex);
      setState(previousState);
      onUndo?.(previousState);
    }
  }, [currentIndex, history, onUndo]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      const nextState = history[newIndex].state;
      
      isUndoRedoOperation.current = true;
      setCurrentIndex(newIndex);
      setState(nextState);
      onRedo?.(nextState);
    }
  }, [currentIndex, history, onRedo]);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const reset = useCallback((newState: T, description?: string) => {
    isUndoRedoOperation.current = true;
    setHistory([{ state: newState, timestamp: Date.now(), description }]);
    setCurrentIndex(0);
    setState(newState);
  }, []);

  const clearHistory = useCallback(() => {
    isUndoRedoOperation.current = true;
    setHistory([{ state, timestamp: Date.now() }]);
    setCurrentIndex(0);
  }, [state]);

  return {
    state,
    setState: pushState,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
    clearHistory,
    history,
    currentIndex,
  };
}

export function useKeyboardUndoRedo<T>(undoRedo: ReturnType<typeof useUndoRedo<T>>) {
  const { undo, redo, canUndo, canRedo } = undoRedo;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
    },
    [undo, redo, canUndo, canRedo],
  );

  return { handleKeyDown };
}
