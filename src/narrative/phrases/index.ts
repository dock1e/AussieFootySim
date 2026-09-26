import type { Phrase, Slot } from "./types";
import { missedCall } from "./missedCall";
import { offerPitch } from "./offerPitch";
import { boardBrief, unveilBody, unveilHeadline } from "./unveil";
import { inboxAssistant, inboxCaptain, inboxFitness, inboxListManager, inboxPresident } from "./inbox";
import {
  splashCaptainLoss,
  splashCaptainWin,
  splashFootLoss,
  splashFootWin,
  splashHeadlineLoss,
  splashHeadlineWin,
  splashMedalCitation,
  splashPlayerCitation,
  splashSubLoss,
  splashSubWin,
} from "./splash";
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
  "splash.headline.win": splashHeadlineWin,
  "splash.headline.loss": splashHeadlineLoss,
  "splash.sub.win": splashSubWin,
  "splash.sub.loss": splashSubLoss,
  "splash.captainQuote.win": splashCaptainWin,
  "splash.captainQuote.loss": splashCaptainLoss,
  "splash.medalCitation": splashMedalCitation,
  "splash.playerCitation": splashPlayerCitation,
  "splash.footNote.win": splashFootWin,
  "splash.footNote.loss": splashFootLoss,
};

export const SLOTS = Object.keys(PHRASE_BANK) as Slot[];
