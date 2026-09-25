import { anyLines, byStatus, p, type Phrase } from "./types";

/** Day one inbox: one message per role. */

export const inboxPresident: Phrase[] = [
  ...anyLines("inbox.president", [
    "Welcome, {coachFirst}. The members are buzzing. We're behind you.",
    "Glad to finally have you in the building. My door is always open.",
  ]),
  ...byStatus("inbox.president", "contender", [
    "Welcome aboard. This list is built to win now. Anything you need, ask.",
    "The board expects a big year, {coachFirst}. So do I. We'll back every call you make.",
    "We finished {finish}. That's not good enough for this group, and I know you agree.",
    "No settling-in period here, I'm afraid. The members want a flag and they want it soon.",
    "You have the best list in your career on day one. Let's make it count.",
    "Sponsors, members, media: I'll handle all of it. You just coach.",
    "Two years is a short deal because we expect results fast. Prove us right.",
    "Big crowds are booked for Round 1. Let's give them a show.",
  ]),
  ...byStatus("inbox.president", "rising", [
    "Welcome, coach. The young group can't wait to meet you.",
    "We think this list is a year from something special. You're the reason why.",
    "Finals are the aim, but growth is the measure. We'll be patient with the right progress.",
    "{topYoungster}'s family rang me to say how happy they are you're here.",
    "Membership is up already. People can see where this club is heading.",
    "Coach the kids hard. The board will cop any short-term pain.",
    "You've got the youngest engine room in the league. Enjoy it.",
    "This could be the start of a long run. Let's do it properly.",
  ]),
  ...byStatus("inbox.president", "middle", [
    "Welcome in. This club has drifted in the middle long enough. We think you're the fix.",
    "We want finals. More than that, we want a side people are scared of.",
    "The talent is here, {coachFirst}. The board believes you can unlock it.",
    "Last year's {finish} wasn't a disaster, but it wasn't us either.",
    "You'll get full support from the board. We only ask for a clear direction.",
    "Members are cautiously excited. A good start would win them over.",
    "Three years is enough time to build something real. Use it.",
    "Honest list, honest club. We'll be honest with you too.",
  ]),
  ...byStatus("inbox.president", "sleepingGiant", [
    "Welcome, coach. This is the biggest club in the game, and it's been asleep too long.",
    "The members are desperate for a winner. They'll love you if you give them one.",
    "Media will be relentless. Ignore it. The board won't flinch.",
    "For this club, {finish} is unacceptable. I know you'll change it.",
    "Money is no object this year. Tell me what the footy department needs.",
    "Sixty thousand members bought in on the strength of your appointment.",
    "Our history is a weight and a weapon. Use the weapon part.",
    "I've waited years to make this call. Glad you picked up.",
  ]),
  ...byStatus("inbox.president", "reset", [
    "Welcome, {coachFirst}. We slipped last year. We don't plan to stay down.",
    "The list is better than {finish}. We need you to show the league that.",
    "It's a reset, not a rebuild. The board expects us competitive from Round 1.",
    "We made mistakes. Hiring you wasn't one of them.",
    "Clear the decks if you need to. We trust your judgement.",
    "Members are frustrated, but they'll come back quickly if we're brave.",
    "A four-year deal gives you room. Use the first one to set the standard.",
    "The footy department is yours to shape. Start whenever you're ready.",
  ]),
  ...byStatus("inbox.president", "rebuild", [
    "Welcome, coach. Results won't define this year. Development will.",
    "No pressure from the board for two seasons. Build it properly.",
    "After {finish}, the only direction is up, and we'll give you time to get there.",
    "The kids are the club's future. You're their teacher.",
    "Draft capital, cap space, patience. You have all three.",
    "The members understand where we are. They just want to see a plan.",
    "Long deal, full backing. This is your club now.",
    "Build the culture first. The board is here for the long haul.",
  ]),
];

export const inboxCaptain: Phrase[] = [
  ...anyLines("inbox.captain", [
    "Boys are keen to hear the plan. Happy to sit down whenever suits before the first main session.",
    "Welcome, coach. Leadership group's ready when you are.",
    "Heard great things. We'll be first in and last out this pre-season.",
  ]),
  ...byStatus("inbox.captain", "contender", ["We've been close too many times. Whatever you need from the playing group, you'll get.", "The group knows the window's now. Let's not waste it."]),
  ...byStatus("inbox.captain", "rising", ["The young blokes are pumped. Might need you to calm them down.", "We're a young group, but a hungry one. Push us hard."]),
  ...byStatus("inbox.captain", "middle", ["We know we're better than last year. Show us how.", "The group wants a clear identity. Give us one and we'll run with it."]),
  ...byStatus("inbox.captain", "sleepingGiant", ["The pressure here is huge. The boys are ready to wear it.", "Everyone's sick of hearing what this club used to be. Let's change the story."]),
  ...byStatus("inbox.captain", "reset", ["Last year hurt. Nobody wants to feel that again.", "We lost our way. The leaders are ready to buy in completely."]),
  ...byStatus("inbox.captain", "rebuild", ["Plenty of young blokes on the list. The leaders will look after them.", "We know it's a build. We'll set the standards for the kids."]),
  p("inbox.captain.rival.01", "Round 1 against {rival}. Boys have had it circled since the fixture dropped.", { r1IsRival: true }),
  p("inbox.captain.rival.02", "{rivalNick} first up. No bigger way to start a coaching career.", { r1IsRival: true }),
  p("inbox.captain.rival.03", "Rivalry round to open the season. The group is already fired up.", { r1IsRival: true }),
  p("inbox.captain.rival.04", "Opening against {rival}. The members will be loud, and so will we.", { r1IsRival: true }),
  p("inbox.captain.revenge.01", "{r1} got us {r1Result} last time. Nobody's forgotten.", { r1LastResult: "L" }),
  p("inbox.captain.revenge.02", "We lost to the {r1Nick} last time we met. The boys want that one back.", { r1LastResult: "L" }),
  p("inbox.captain.revenge.03", "{r1Result} against {r1} last time. It still stings.", { r1LastResult: "L" }),
  p("inbox.captain.revenge.04", "Round 1 is a chance to square things with the {r1Nick}. We're ready.", { r1LastResult: "L" }),
];

export const inboxListManager: Phrase[] = [
  ...anyLines("inbox.listManager", [
    "We're sitting at {listAvg} list average, and our best 22 is {listRank} in the comp. Plenty to work with.",
    "List review is on your desk. Contracts, form and out-of-contract names are flagged.",
    "Keen to talk list strategy before the trade and draft planning starts.",
  ]),
  ...byStatus("inbox.listManager", "contender", ["Top-end talent ranks {listRank} in the league. It's a list built to win now.", "Might be worth a look at the rookie list for depth. Contenders need it in August."]),
  ...byStatus("inbox.listManager", "rising", ["{topYoungster} is tracking beautifully. We should lock him up early.", "Young list, lots of upside. Development coaches will be key."]),
  ...byStatus("inbox.listManager", "middle", ["Best 22 ranks {listRank} for strength. We're closer than the ladder says.", "Honest list. A couple of smart moves could lift us a tier."]),
  ...byStatus("inbox.listManager", "sleepingGiant", ["Big list, uneven quality. We need to find our best 22 fast.", "Plenty of contracts to sort. The members will want stars kept."]),
  ...byStatus("inbox.listManager", "reset", ["Our best 22 ranks {listRank}. The ladder said {finish}. That gap is our opportunity.", "A few senior contracts to look at. Worth deciding who's in the plan."]),
  ...byStatus("inbox.listManager", "rebuild", ["Our picks are gold this year. Worth planning the draft early.", "Young core is building. {topYoungster} is the jewel."]),
];

export const inboxFitness: Phrase[] = [
  ...anyLines("inbox.fitness", [
    "Two soft-tissue concerns carried over. Worth managing loads in the practice match.",
    "Pre-season testing starts Monday. Happy to share the numbers once they're in.",
    "Most of the group came back in good shape. A few need a longer ramp-up.",
  ]),
  ...byStatus("inbox.fitness", "contender", ["Older list, so load management matters. I'll send the plan.", "We want them peaking in September, not March. I'll pace it."]),
  ...byStatus("inbox.fitness", "rising", ["The kids can run all day. Now they need strength.", "Young bodies bounce back quickly. We can train hard early."]),
  ...byStatus("inbox.fitness", "middle", ["Fitness base is decent. Room to push the top-end speed work.", "Running numbers were average last year. We can lift them."]),
  ...byStatus("inbox.fitness", "sleepingGiant", ["Standards slipped last year. The group knows they have to get fitter.", "The GPS numbers were down. Expect a big lift this pre-season."]),
  ...byStatus("inbox.fitness", "reset", ["We'll reset the running programme too. New coach, new standard.", "Injury count was too high last year. We've changed the recovery plan."]),
  ...byStatus("inbox.fitness", "rebuild", ["Lots of young bodies. We'll manage their loads carefully.", "The kids need a couple of years in the gym. It'll pay off."]),
  p("inbox.fitness.rival.01", "Rivalry game first up. We'll peak them for Round 1, not just survive it.", { r1IsRival: true }),
  p("inbox.fitness.rival.02", "{rival} in Round 1 means a high-intensity opener. We'll plan for it.", { r1IsRival: true }),
  p("inbox.fitness.rival.03", "Blockbuster opener. We'll taper the week before.", { r1IsRival: true }),
  p("inbox.fitness.rival.04", "Big crowd, big emotion in Round 1. We need them fresh.", { r1IsRival: true }),
];

export const inboxAssistant: Phrase[] = [
  ...anyLines("inbox.assistant", [
    "Welcome, coach. I've pulled last year's vision into a highlights pack for you.",
    "Game-plan whiteboard is cleaned off. It's yours.",
    "The line coaches are keen to hear your structures. Let me know when.",
  ]),
  ...byStatus("inbox.assistant", "contender", ["We were close last year. Small tweaks, big gains.", "Our stoppage work is strong. Ball movement is where we can improve."]),
  ...byStatus("inbox.assistant", "rising", ["The young group learns fast. Give them a system and they'll own it.", "I've got notes on every young player. Happy to walk you through them."]),
  ...byStatus("inbox.assistant", "middle", ["We need a clear identity. I'm keen to hear yours.", "Our pressure numbers were mid-table. That's the first fix."]),
  ...byStatus("inbox.assistant", "sleepingGiant", ["The players want structure. They haven't had a clear plan in years.", "Big club, lots of voices. We need one message. Yours."]),
  ...byStatus("inbox.assistant", "reset", ["Last year's structures didn't work. Blank page is fine by me.", "I've mapped where we went wrong. Short read, worth it."]),
  ...byStatus("inbox.assistant", "rebuild", ["Teaching first, results later. I'm on board.", "The kids need repetition. I'll build the drills around your system."]),
  p("inbox.assistant.rival.01", "I've started on {rival} vision already. They'll be up for it.", { r1IsRival: true }),
  p("inbox.assistant.rival.02", "{rivalNick} in Round 1. Their midfield will come hard. We should too.", { r1IsRival: true }),
  p("inbox.assistant.rival.03", "Rivalry opener, so expect a scrap. I'll prep the stoppage plan.", { r1IsRival: true }),
  p("inbox.assistant.rival.04", "Everything about Round 1 will be emotional. Our structures need to be calm.", { r1IsRival: true }),
];
