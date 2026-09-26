import { lines, type Phrase } from "./types";

/**
 * Big Game Splash copy (brief §4). Wins bask in the moment and celebrate the players; losses are
 * dignified and forward-looking. On Anzac Day and King's Birthday the cause and the day come before the
 * result. Numbers only ever come from tokens ({margin}, {crowd}, {statValue}…), never the text, so the
 * copy can't disagree with the scoreboard.
 */

const GF = { event: ["grandFinal" as const] };
const ANZAC = { event: ["anzac" as const] };
const KB = { event: ["kingsBirthday" as const] };
const ROUND = { event: ["anzac" as const, "kingsBirthday" as const] };

export const splashHeadlineWin: Phrase[] = [
  // Grand Final: three words at most.
  ...lines("splash.headline.win", "gf", ["Premiers.", "Champions.", "The flag.", "It's ours.", "Premiership glory.", "On top.", "Cup's coming home.", "Kings of September."], GF),
  ...lines("splash.headline.win", "first", ["First ever flag."], { ...GF, isFirstFlag: true }),
  ...lines("splash.headline.win", "drought", ["At last."], { ...GF, flagDroughtMin: 20 }),
  ...lines("splash.headline.win", "repeat", ["Back-to-back."], { ...GF, repeatWinner: true }),
  ...lines("splash.headline.win", "comeback", ["Came from behind."], { ...GF, comeback: true }),
  ...lines("splash.headline.win", "thrashing", ["A masterclass."], { ...GF, thrashing: true }),
  ...lines("splash.headline.win", "anzac", ["Anzac Day belongs to the {nick}.", "Anzac glory for the {nick}.", "The {nick} honour the day.", "A win worthy of the day."], ANZAC),
  ...lines("splash.headline.win", "kb", ["The Big Freeze, sealed.", "Warm win on a cold day.", "The {nick} win the Big Freeze.", "A King's Birthday to remember."], KB),
  ...lines("splash.headline.win", "round", ["Big day, big win.", "The {nick} stand tall.", "Won the day that matters.", "Done and dusted, {nick}."], ROUND),
  ...lines("splash.headline.win", "roundComeback", ["From behind, and over the line."], { ...ROUND, comeback: true }),
];

export const splashHeadlineLoss: Phrase[] = [
  ...lines("splash.headline.loss", "gf", ["Not this year.", "So close.", "Runners-up, and it hurts.", "One step short.", "Heartbreak at {venue}.", "A Grand Final to learn from.", "Beaten on the biggest stage.", "Second, and hungry for more.", "Not our day in September."], GF),
  ...lines("splash.headline.loss", "gfThriller", ["A kick short of a flag."], { ...GF, thriller: true }),
  ...lines("splash.headline.loss", "anzac", ["Anzac Day goes to the {oppNick}.", "Not our Anzac Day.", "Respect to the {oppNick} today.", "The day is bigger than the result."], ANZAC),
  ...lines("splash.headline.loss", "kb", ["Cold day at the 'G.", "No warmth in this one.", "Beaten in the Big Freeze.", "The cause wins. We didn't."], KB),
  ...lines("splash.headline.loss", "round", ["A big day gets away.", "Not good enough today.", "The {oppNick} take the honours."], ROUND),
];

export const splashSubWin: Phrase[] = [
  ...lines("splash.sub.win", "gf", [
    "The {clubFull} are the {year} premiers. {coach}'s side won by {margin} in front of {crowd}.",
    "A {margin}-point Grand Final win over {opp}. The {nick} are premiers for the {flagNumber} time.",
    "{coach}'s {coachSeason} season as coach ends with a flag. The {nick} beat {opp} by {margin}.",
    "Premiers. {crowd} saw the {nick} beat {opp} by {margin} on the biggest day of the year.",
    "Grand Final day belonged to the {nick}. They beat {opp} by {margin} and the celebrations will go long into the night.",
  ], GF),
  ...lines("splash.sub.win", "first", ["The first premiership in club history. The {nick} beat {opp} by {margin} and nobody at {venue} will forget it."], { ...GF, isFirstFlag: true }),
  ...lines("splash.sub.win", "drought", ["{flagDrought} years of waiting are over. The {nick} win the flag by {margin}."], { ...GF, flagDroughtMin: 20 }),
  ...lines("splash.sub.win", "comeback", ["Behind at three-quarter time, the {nick} found a way. Premiers by {margin}."], { ...GF, comeback: true }),
  ...lines("splash.sub.win", "thriller", ["A Grand Final decided in the final minutes. The {nick} hold on by {margin} to win the flag."], { ...GF, thriller: true }),
  ...lines("splash.sub.win", "thrashing", ["The {nick} put on a Grand Final masterclass, beating {opp} by {margin}."], { ...GF, thrashing: true }),
  ...lines("splash.sub.win", "repeat", ["The {nick} defend the flag with a {margin}-point win over {opp}. Back-to-back premiers."], { ...GF, repeatWinner: true }),
  ...lines("splash.sub.win", "wire", ["Led at every change and never let go. The {nick} are premiers by {margin}."], { ...GF, wireToWire: true }),
  ...lines("splash.sub.win", "anzac", [
    "In front of {crowd}, the {nick} hold their nerve in the traditional game and win by {margin}.",
    "{coach} wins a first Anzac Day as coach. The {nick} beat {opp} by {margin}.",
    "The {nick} give {crowd} at {venue} a performance worthy of the occasion, winning by {margin}.",
  ], ANZAC),
  ...lines("splash.sub.win", "kb", [
    "The {nick} win on King's Birthday by {margin}. The day raises millions for MND research, and the crowd got a win to remember.",
    "A win by {margin} in the Big Freeze. The cause comes first, but the {nick} will enjoy this one.",
    "{crowd} braved the cold for a great cause, and the {nick} rewarded them with a {margin}-point win.",
  ], KB),
  ...lines("splash.sub.win", "round", ["The {nick} beat {opp} by {margin} on one of the biggest days of the season."], ROUND),
  ...lines("splash.sub.win", "roundThriller", ["It came down to the last few minutes, but the {nick} held on by {margin}."], { ...ROUND, thriller: true }),
  ...lines("splash.sub.win", "roundComeback", ["Trailing at the last change, the {nick} came home strongly to win by {margin}."], { ...ROUND, comeback: true }),
  ...lines("splash.sub.win", "rivalry", ["Old rivals, a big crowd, and the {nick} come out on top by {margin}."], { rivalry: true }),
  ...lines("splash.sub.win", "oppMedal", ["{medallist} was best on ground for {opp}, but the {nick} had the numbers and won by {margin}."], { oppMedallist: true }),
  ...lines("splash.sub.win", "roundRepeat", ["Two years running on {event}. The {nick} beat {opp} by {margin} again."], { ...ROUND, repeatWinner: true }),
];

export const splashSubLoss: Phrase[] = [
  ...lines("splash.sub.loss", "gf", [
    "{opp} are the {year} premiers. {margin} points short on the biggest day. It hurts because the group got so close.",
    "The {nick} fall {margin} points short of a flag. A Grand Final is never wasted if the group learns from it.",
    "Runners-up to {opp} by {margin}. The season ends one game early, and the work for next year starts now.",
  ], GF),
  ...lines("splash.sub.loss", "gfThriller", ["Beaten by {margin} in a Grand Final that went down to the wire. The gap between a flag and heartbreak was a kick."], { ...GF, thriller: true }),
  ...lines("splash.sub.loss", "gfThrashing", ["{opp} were too good, winning by {margin}. The group will carry this one into pre-season."], { ...GF, thrashing: true }),
  ...lines("splash.sub.loss", "anzac", [
    "{opp} win the Anzac Day match by {margin}. The {nick} fought to the end, but the day matters more than the result.",
    "In front of {crowd}, the {nick} went down by {margin}, proud to play their part on a day that means so much.",
    "The {oppNick} were too good in the traditional game, winning by {margin}. Lest we forget.",
  ], ANZAC),
  ...lines("splash.sub.loss", "kb", [
    "{opp} win on King's Birthday by {margin}. The cause matters more than the result, but the group will want this one back.",
    "The Big Freeze raised millions for MND research. On the field, {opp} were better by {margin}.",
    "Today was about far more than footy. The {nick} lost by {margin} and go again next week.",
  ], KB),
  ...lines("splash.sub.loss", "round", ["The {nick} go down by {margin} on a big day. The group will learn from it and move on."], ROUND),
  ...lines("splash.sub.loss", "thriller", ["A {margin}-point loss that could have gone either way. The {nick} will rue the chances they left out there."], { ...ROUND, thriller: true }),
  ...lines("splash.sub.loss", "thrashing", ["A heavy loss, {margin} points. The {nick} will look hard at this one."], { ...ROUND, thrashing: true }),
  ...lines("splash.sub.loss", "rivalry", ["Beaten by old rivals, {margin} points. It stings, and it should."], { rivalry: true }),
  ...lines("splash.sub.loss", "oppMedal", ["Consolation for {medallist}, best on ground in a losing side. {opp} won by {margin}."], { oppMedallist: true }),
  ...lines("splash.sub.loss", "gfOppMedal", ["{medallist} won the medal in a losing Grand Final side. It was that kind of effort, and it still came up {margin} points short."], { ...GF, oppMedallist: true }),
];

export const splashCaptainWin: Phrase[] = [
  ...lines("splash.captainQuote.win", "gf", [
    "That's for every supporter who stuck with us. The coach saw something in this group nobody else did.",
    "I dreamed about this as a kid. To do it with these blokes is everything.",
    "We said at the start of the year we'd be here. Nobody outside the four walls believed us.",
    "Look at the fans. This is what they deserve. Every one of them.",
  ], GF),
  ...lines("splash.captainQuote.win", "first", ["First flag in the club's history. Every past player owns a piece of this."], { ...GF, isFirstFlag: true }),
  ...lines("splash.captainQuote.win", "drought", ["{flagDrought} years. I hope every supporter who waited is enjoying this as much as we are."], { ...GF, flagDroughtMin: 20 }),
  ...lines("splash.captainQuote.win", "repeat", ["Doing it twice is harder than once. This group has something special."], { ...GF, repeatWinner: true }),
  ...lines("splash.captainQuote.win", "comeback", ["At three-quarter time we just looked at each other and said, not today."], { comeback: true }),
  ...lines("splash.captainQuote.win", "anzac", [
    "There's no bigger game in the home and away season. To win it for the club and for what the day stands for means a lot.",
    "The Last Post before the bounce always gets you. We wanted to play a game worthy of it.",
    "Anzac Day is about the people who gave everything. We just tried to honour that.",
  ], ANZAC),
  ...lines("splash.captainQuote.win", "kb", [
    "Days like this are bigger than footy. Winning it just makes it that bit more special.",
    "We play for the cause first. The four points are a bonus.",
    "Nobody minds the cold on a day like this, especially after a win.",
  ], KB),
  ...lines("splash.captainQuote.win", "round", ["Proud of every one of the {nick} today. We stuck to the plan all day.", "Big days need big players, and ours stood up."], ROUND),
  ...lines("splash.captainQuote.win", "thriller", ["My heart's still going. We found a way when it mattered."], { thriller: true }),
  ...lines("splash.captainQuote.win", "oppMedal", ["{medallist} was brilliant for them, but our group won it together."], { oppMedallist: true }),
];

export const splashCaptainLoss: Phrase[] = [
  ...lines("splash.captainQuote.loss", "gf", [
    "We gave everything. It wasn't enough today, but this group will be back here. I'm sure of it.",
    "Credit to {opp}. They were better on the day. We'll use this.",
    "Nothing hurts like losing a Grand Final. Remember this feeling.",
  ], GF),
  ...lines("splash.captainQuote.loss", "gfThriller", ["A kick. That's all it was. We'll live with that one for a while."], { ...GF, thriller: true }),
  ...lines("splash.captainQuote.loss", "thrashing", ["They were too good. We have to be honest about why."], { thrashing: true }),
  ...lines("splash.captainQuote.loss", "anzac", [
    "Proud of the effort. We'll learn from it and be better for it next year.",
    "It's an honour to play on Anzac Day. The result hurts, but the day is bigger than us.",
    "Lest we forget. That's what today is about, more than any scoreboard.",
  ], ANZAC),
  ...lines("splash.captainQuote.loss", "kb", [
    "The result stings. The cause matters more. We go again next week.",
    "Every dollar raised today matters more than the scoreboard.",
    "Proud to be part of the Big Freeze. Not proud of how we played.",
  ], KB),
  ...lines("splash.captainQuote.loss", "round", ["We'll own this one and move on together.", "Not good enough from us, and we know it."], ROUND),
  ...lines("splash.captainQuote.loss", "rivalry", ["Losing to them hurts more than most. We'll remember it."], { rivalry: true }),
  ...lines("splash.captainQuote.loss", "oppMedal", ["{medallist} was our best by a mile. Wish we could have got it done for him."], { oppMedallist: true }),
];

/** One sentence about the medallist, keyed on his best stat (`statKey` = his top stat). */
export const splashMedalCitation: Phrase[] = [
  ...lines("splash.medalCitation", "any", [
    "Best on ground by the judges' count, with {medallistStat1}.",
    "Stood tallest when it mattered most. {medallistStat1}.",
    "A big-game performance to remember: {medallistStat1}.",
  ]),
  ...lines("splash.medalCitation", "disposals", ["Everywhere all day. {medallistStat1} and {medallistStat2}, with barely a wasted kick."], { stat: ["disposals"] }),
  ...lines("splash.medalCitation", "goals", ["The difference on the scoreboard. {medallistStat1}, each one when the game was there to be won."], { stat: ["goals"] }),
  ...lines("splash.medalCitation", "clearances", ["First to every stoppage. {medallistStat1} set the tone from the opening bounce."], { stat: ["clearances"] }),
  ...lines("splash.medalCitation", "tackles", ["Relentless pressure. {medallistStat1} and a willingness to do the hard things all day."], { stat: ["tackles"] }),
  ...lines("splash.medalCitation", "marks", ["Clunked everything that came near him. {medallistStat1} and {medallistStat2}."], { stat: ["marks"] }),
  ...lines("splash.medalCitation", "contestedMarks", ["Owned the air. {medallistStat1} in the moments that turned the game."], { stat: ["contestedMarks"] }),
  ...lines("splash.medalCitation", "intercepts", ["Read the play better than anyone. {medallistStat1}, and time after time the ball came back."], { stat: ["intercepts"] }),
  ...lines("splash.medalCitation", "hitouts", ["Gave his midfield first use all day. {medallistStat1} and {medallistStat2}."], { stat: ["hitouts"] }),
  ...lines("splash.medalCitation", "contestedPoss", ["Won it the hard way. {medallistStat1} at the coalface and {medallistStat2} to go with it."], { stat: ["contestedPoss"] }),
  ...lines("splash.medalCitation", "goalAssists", ["The creator. {medallistStat1} and a hand in every big moment up forward."], { stat: ["goalAssists"] }),
  ...lines("splash.medalCitation", "spoils", ["The wall in defence. {medallistStat1} and hardly a contest conceded."], { stat: ["spoils"] }),
  ...lines("splash.medalCitation", "marksInside50", ["A constant target up forward. {medallistStat1} and {medallistStat2}."], { stat: ["marksInside50"] }),
];

/** One sentence per stood-up player, keyed on his top stat. */
export const splashPlayerCitation: Phrase[] = [
  ...lines("splash.playerCitation", "any", ["Did his job and more on the big day.", "Stood up when the game was on the line.", "Played his role to perfection."]),
  ...lines("splash.playerCitation", "disposals", ["Found the ball {statValue} times and made most of them count.", "Ran all day for his {statValue} disposals."], { stat: ["disposals"] }),
  ...lines("splash.playerCitation", "goals", ["Hit the scoreboard with {statValue} goals when it mattered.", "Dangerous every time it went forward. {statValue} goals."], { stat: ["goals"] }),
  ...lines("splash.playerCitation", "clearances", ["Won {statValue} clearances and gave his side first use.", "First to the ball out of the middle, {statValue} times."], { stat: ["clearances"] }),
  ...lines("splash.playerCitation", "tackles", ["Laid {statValue} tackles and set the standard for pressure.", "Brought the heat all day with {statValue} tackles."], { stat: ["tackles"] }),
  ...lines("splash.playerCitation", "marks", ["Took {statValue} marks and was a reliable target all day."], { stat: ["marks"] }),
  ...lines("splash.playerCitation", "contestedMarks", ["Clunked {statValue} contested marks when the ball was in dispute."], { stat: ["contestedMarks"] }),
  ...lines("splash.playerCitation", "intercepts", ["Cut off {statValue} of the opposition's attacks."], { stat: ["intercepts"] }),
  ...lines("splash.playerCitation", "hitouts", ["Gave the mids first use with {statValue} hitouts."], { stat: ["hitouts"] }),
  ...lines("splash.playerCitation", "contestedPoss", ["Won {statValue} contested possessions at the coalface."], { stat: ["contestedPoss"] }),
  ...lines("splash.playerCitation", "goalAssists", ["Set up {statValue} goals for his teammates."], { stat: ["goalAssists"] }),
  ...lines("splash.playerCitation", "spoils", ["Killed {statValue} contests in defence with timely spoils."], { stat: ["spoils"] }),
  ...lines("splash.playerCitation", "marksInside50", ["Presented up forward all day and took {statValue} marks inside fifty."], { stat: ["marksInside50"] }),
];

export const splashFootWin: Phrase[] = [
  ...lines("splash.footNote.win", "any", [
    "The full match report, stats and ratings are on the next screen.",
    "Soak it in. The numbers are on the next screen.",
    "Take a bow. The match report is one click away.",
    "Every stat from the day is waiting in the match report.",
    "Enjoy the moment. The detail can wait for the next screen.",
    "When you're ready, the full report is next.",
    "The rooms are loud. The match report is quieter.",
    "Nights like this are rare. The full report is next.",
    "Ratings, votes and box score: all on the next screen.",
    "Replay it, or head to the full match report.",
  ]),
  ...lines("splash.footNote.win", "first", ["History made. The full match report is on the next screen."], { ...GF, isFirstFlag: true }),
  ...lines("splash.footNote.win", "drought", ["The wait is over. The full match report is on the next screen."], { ...GF, flagDroughtMin: 20 }),
];

export const splashFootLoss: Phrase[] = lines("splash.footNote.loss", "any", [
  "Take a moment. The full match report is on the next screen.",
  "The detail is on the next screen, when you're ready.",
  "Learn from it. The full report is next.",
  "Every lesson from today is in the match report.",
  "Hard to look at, but the numbers are on the next screen.",
  "Regroup. The match report is waiting.",
  "The group will review it. So can you, on the next screen.",
  "Tomorrow is another day. The full report is next.",
  "The box score and ratings are one click away.",
  "Heads up. The full match report is on the next screen.",
]);
