import { useGameStore } from '@/context/game-context';

export function useGame() {
  return useGameStore();
}
