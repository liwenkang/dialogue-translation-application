import { create } from "zustand";
import type { LanguageCode } from "../../shared/constants";
import { DEFAULT_TARGET_LANG } from "../../shared/constants";

interface SettingsState {
  targetLang: LanguageCode;
  translationEnabled: boolean;
  showModelManager: boolean;
  highlightLang: string | null;
  setTargetLang: (lang: LanguageCode) => void;
  setTranslationEnabled: (enabled: boolean) => void;
  toggleTranslation: () => void;
  setShowModelManager: (show: boolean) => void;
  openModelManager: (lang?: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  targetLang: DEFAULT_TARGET_LANG,
  translationEnabled: false,
  showModelManager: false,
  highlightLang: null,
  setTargetLang: (targetLang) => set({ targetLang }),
  setTranslationEnabled: (translationEnabled) => set({ translationEnabled }),
  toggleTranslation: () =>
    set((state) => ({ translationEnabled: !state.translationEnabled })),
  setShowModelManager: (showModelManager) =>
    set({ showModelManager, ...(showModelManager ? {} : { highlightLang: null }) }),
  openModelManager: (lang) =>
    set({ showModelManager: true, highlightLang: lang ?? null }),
}));
