import type { Phrase, Slot } from "./types";
import { missedCall } from "./missedCall";
import { offerPitch } from "./offerPitch";
import { boardBrief, unveilBody, unveilHeadline } from "./unveil";
import { inboxAssistant, inboxCaptain, inboxFitness, inboxListManager, inboxPresident } from "./inbox";
import { dashSubline, pressClipping, taskDept, taskList, taskPlan, taskScout } from "./system";

/** New Game Onboarding — the whole phrase bank, keyed by slot (see `phraseEngine.ts` for how lines are picked). */
export const PHRASE_BANK: Record<Slot, Phrase[]> = {
  missedCall,
  offerPitch,
  unveilHeadline,
  unveilBody,
  boardBrief,
  "inbox.president": inboxPresident,
  "inbox.captain": inboxCaptain,
  "inbox.listManager": inboxListManager,
  "inbox.fitness": inboxFitness,
  "inbox.assistant": inboxAssistant,
  "taskBlurb.plan": taskPlan,
  "taskBlurb.list": taskList,
  "taskBlurb.dept": taskDept,
  "taskBlurb.scout": taskScout,
  dashSubline,
  pressClipping,
};

export const SLOTS = Object.keys(PHRASE_BANK) as Slot[];
