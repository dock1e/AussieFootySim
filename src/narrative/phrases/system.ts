import { anyLines, byStatus, type Phrase } from "./types";

/** Day one checklist descriptions. Speaker: the system. */

export const taskPlan: Phrase[] = [
  ...anyLines("taskBlurb.plan", [
    "Squad structure, roles, rotations and game style. Used every week until you change it.",
    "Set the team, the rotations and the style once. It carries week to week.",
    "Your standing plan: who plays where, who rests when, and how you want to move the ball.",
  ]),
  ...byStatus("taskBlurb.plan", "contender", ["A contender needs a settled side. Lock in the best 22 and the rotations.", "Pick the style that wins now. The list can handle any of them."]),
  ...byStatus("taskBlurb.plan", "rising", ["Pick a style that suits young legs. Rotations matter with a young group.", "Give the kids clear roles. The structure will carry them."]),
  ...byStatus("taskBlurb.plan", "middle", ["Give the side an identity: pick a style and stick with it.", "Settle the structure early. Middle sides lose games on confusion."]),
  ...byStatus("taskBlurb.plan", "sleepingGiant", ["The members want to see a plan. Set one, and set it early.", "Pick your best 22 and your style. Every eye will be on Round 1."]),
  ...byStatus("taskBlurb.plan", "reset", ["New plan, new roles. Clarity for every player before Round 1.", "Reset the structures. Choose a style that fits the list you have."]),
  ...byStatus("taskBlurb.plan", "rebuild", ["Build the plan around the young core. Give them games and roles.", "Choose a style to grow into, not just one to survive with."]),
];

export const taskList: Phrase[] = [
  ...anyLines("taskBlurb.list", [
    "{star} and the leadership group are waiting. Review contracts and who's out of form.",
    "Meet the players, read the contracts, and see who's due for a new deal.",
    "Get to know the list: {captain} leads it, {star} tops it.",
  ]),
  ...byStatus("taskBlurb.list", "contender", ["A win-now list. Check the depth behind {star} and the senior core.", "Contracts on the senior group need a look before they become distractions."]),
  ...byStatus("taskBlurb.list", "rising", ["{topYoungster} leads a young core. See who's ready for more games.", "Young list, lots of upside. Find who's closest to breaking out."]),
  ...byStatus("taskBlurb.list", "middle", ["Work out who's in your best 22 and who's holding a spot.", "An honest list. Find the players who can lift it a tier."]),
  ...byStatus("taskBlurb.list", "sleepingGiant", ["Big list, uneven quality. Work out who's in the plan.", "{star} is the headline. Find out who else you can count on."]),
  ...byStatus("taskBlurb.list", "reset", ["Decide who's part of the reset and who isn't.", "Some senior players are out of form. Review them first."]),
  ...byStatus("taskBlurb.list", "rebuild", ["Meet the kids. {topYoungster} is the jewel of the list.", "Check the young core and the draft picks you'll build around."]),
];

export const taskDept: Phrase[] = [
  ...anyLines("taskBlurb.dept", [
    "Pick a line coach for each third and a head of development.",
    "Build your coaching panel: a coach for each line, plus development.",
    "Hire the assistants you trust. They'll run the lines on match day.",
  ]),
  ...byStatus("taskBlurb.dept", "contender", ["A contender needs experienced line coaches. Pick the best available.", "Match-day coaches matter most in close finals. Choose well."]),
  ...byStatus("taskBlurb.dept", "rising", ["Development coaching is the priority with this young list.", "Hire teachers. This group will learn fast from the right people."]),
  ...byStatus("taskBlurb.dept", "middle", ["The right line coaches could be the difference in close games.", "Find assistants who fit your style, not just good names."]),
  ...byStatus("taskBlurb.dept", "sleepingGiant", ["There's budget for the best staff. Use it.", "Big club, big budget. Build the best panel in the league."]),
  ...byStatus("taskBlurb.dept", "reset", ["A reset starts in the coaches' box. Pick fresh assistants.", "New voices for a new plan. Appoint your line coaches."]),
  ...byStatus("taskBlurb.dept", "rebuild", ["A head of development is the key hire in a rebuild.", "Hire patient teachers. The kids will spend years with them."]),
];

export const taskScout: Phrase[] = [
  ...anyLines("taskBlurb.scout", [
    "{r1} in Round 1. See where they're vulnerable.",
    "Scout the {r1Nick}: their danger men, their style, their weak spots.",
    "Look over {r1} before you set your tags and your game style.",
  ]),
  ...byStatus("taskBlurb.scout", "contender", ["A contender can't drop Round 1. Know {r1} inside out.", "Find the match-up that wins the opener against the {r1Nick}."]),
  ...byStatus("taskBlurb.scout", "rising", ["Round 1 against {r1} is a test for the kids. Prepare them.", "Show the young group how {r1} play before they face them."]),
  ...byStatus("taskBlurb.scout", "middle", ["Beat {r1} and the season starts with belief. Scout them properly.", "Work out where {r1} can be hurt, and set the tags."]),
  ...byStatus("taskBlurb.scout", "sleepingGiant", ["The members want a Round 1 win. Scout {r1} closely.", "A big crowd for the opener. Know exactly how {r1} will play."]),
  ...byStatus("taskBlurb.scout", "reset", ["A fast start matters in a reset. Find {r1}'s weak spots.", "Scout {r1} and pick a game style that exposes them."]),
  ...byStatus("taskBlurb.scout", "rebuild", ["A learning chance in Round 1 against {r1}. Know what's coming.", "Scout {r1} so the kids go in with a clear job."]),
];

/** Day one header sub-line. */
export const dashSubline: Phrase[] = [
  ...anyLines("dashSubline", [
    "Day one. {daysToR1} days until Round 1.",
    "First day in the job. Round 1 is {daysToR1} days away.",
    "{daysToR1} days to Round 1. The work starts now.",
  ]),
  ...byStatus("dashSubline", "contender", ["Day one at a contender. {daysToR1} days until the real test.", "A flag to chase, and {daysToR1} days until the chase begins."]),
  ...byStatus("dashSubline", "rising", ["A young list and {daysToR1} days to prepare it.", "Day one with the kids. Round 1 is {daysToR1} days out."]),
  ...byStatus("dashSubline", "middle", ["This side needs an identity, and it has {daysToR1} days to find one.", "Breaking out of the middle starts now. {daysToR1} days to Round 1."]),
  ...byStatus("dashSubline", "sleepingGiant", ["Day one of waking the giant. {daysToR1} days to Round 1.", "The whole state is watching. Round 1 in {daysToR1} days."]),
  ...byStatus("dashSubline", "reset", ["The reset begins. {daysToR1} days until Round 1.", "Turnaround time: {daysToR1} days before Round 1."]),
  ...byStatus("dashSubline", "rebuild", ["First brick of the rebuild. Round 1 is {daysToR1} days away.", "Building starts today. Round 1 in {daysToR1} days."]),
];

/** Optional ticker on Welcome. Fictional outlets only. */
export const pressClipping: Phrase[] = [
  ...anyLines("pressClipping", [
    "Every club wants {coachLast}. Who blinks first? · THE BACK PAGE",
    "The state-league coach rewriting how footy is played · BOUNDARY LINE",
    "Eighteen offers and counting for {coachLast} · INSIDE 50 WEEKLY",
  ]),
  ...byStatus("pressClipping", "contender", ["{club} want a flag coach, and they want {coachLast} · THE HITOUT", "Contenders {club} circle the hottest name in coaching · BOUNDARY LINE"]),
  ...byStatus("pressClipping", "rising", ["Young {nick} make their move for {coachLast} · INSIDE 50 WEEKLY", "Why the {club} kids want {coachLast} · THE BACK PAGE"]),
  ...byStatus("pressClipping", "middle", ["Middle-table {nick} ready to break the bank · THE HITOUT", "Game-changer wanted: {club} join the race · INSIDE 50 WEEKLY"]),
  ...byStatus("pressClipping", "sleepingGiant", ["Giant {club} desperate to land {coachLast} · THE BACK PAGE", "Members demand a big-name coach at {club} · BOUNDARY LINE"]),
  ...byStatus("pressClipping", "reset", ["Fast turnaround the goal as {club} chase {coachLast} · THE HITOUT", "Reset mode at {club}, and one name on the whiteboard · INSIDE 50 WEEKLY"]),
  ...byStatus("pressClipping", "rebuild", ["Rebuilding {club} offer {coachLast} a long deal · BOUNDARY LINE", "Patience is the pitch from the {nick} · THE BACK PAGE"]),
];
