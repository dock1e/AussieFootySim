/**
 * Round C162 — real-world bio/personality/archetype corrections for Adelaide, Brisbane Lions, Carlton,
 * Collingwood, Essendon and Fremantle, from Tyler's six uploaded "AFL Player Database Analysis" club
 * audit reports (written against the 2026-09-29 players_master export). Every "DB" value those reports
 * quote was cross-checked against this CSV before applying: all 197 report rows match exactly.
 *
 * Every write goes through the Player Editor's own single-row-scoped save path
 * (`tools/player-editor/lib.ts`), so no other player's row is touched:
 *   1. BIO — real homeState/height/weight via `saveMetadata` (no recompute; see METADATA_FIELDS'
 *      own doc comment for why height can't desync anything). Adelaide's report only covers its
 *      8-player sample. Ambiguous/self-contradictory origins are resolved in the notes below.
 *   2. PERSONALITY — the reports' explicit slider overrides (not formula inputs), via `writeSingleRow`.
 *   3. ARCHETYPE — the reports' explicit reclassifications. The archetype is set and then
 *      `revertToFormula` regenerates that player's attributes/raw baseline/OVR/POT from their real
 *      2026 stats under the new archetype — the same path the editor uses, so attributes never
 *      desync from archetype (the reason archetype isn't exposed as a plain metadata field).
 *
 * Already on master, so NOT re-applied: the reports' trades (Round C157) and retired/delisted status
 * (Rounds C143-C143g). Skipped: Jye Menzie/Oskar Smartt archetype changes (both Delisted, no real 2026
 * stat row to regenerate from), and the reports' OVR/POT numbers (formula-derived, not hand-set).
 *
 * Origin resolution notes (everything else is the report matrix's single listed state):
 *   Will & Levi Ashcroft "VIC / QLD" -> VIC (Brisbane report's own recommendation)
 *   Zac Bailey "NT / SA" -> NT (junior club Southern Districts, Darwin)
 *   Charlie Cameron: matrix "WA / QLD", recommendation SA -> SA (Glenelg)
 *   Sam Marshall "QLD / SA" -> QLD (Lions Academy); Keidean Coleman "NT / QLD" -> QLD (recommendation)
 *   Will Setterfield, Patrick Voss "NSW / VIC" -> VIC (Sandringham / Oakleigh juniors)
 *   Ben Keays "QLD / VIC" -> QLD (Brisbane Lions Academy)
 *   Jesse Motlop: matrix WA (South Fremantle) vs recommendation SA -> WA
 *   Ashton Moir: matrix SA (Glenelg) vs recommendation VIC -> SA
 *   Sam Sturt: matrix says WA but lists only Victorian juniors (Peninsula Grammar / Dandenong) -> VIC
 *   Conor McKenna (Ireland), Mason Cox (USA): homeState left unchanged.
 *   Josh Worrell: report's real weight is his draft-year weight, so only height is taken.
 *
 * Run with: `node --experimental-strip-types scripts/applyClubAuditRoundC162.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "./csv.ts";
import { loadPopulation, CSV_PATH, ATTRIBUTE_OVERRIDE_COLUMN, saveMetadata, writeSingleRow, revertToFormula, findPlayer } from "../tools/player-editor/lib.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

type BioFix = { id: number; name: string; homeState?: string; height?: number; weight?: number };

const BIO_FIXES: BioFix[] = [
  { id: 1001, name: "Jordan Dawson", homeState: "SA", height: 190, weight: 91 },
  { id: 1002, name: "Rory Laird", homeState: "SA", height: 178, weight: 86 },
  { id: 1003, name: "Josh Worrell", height: 195 },
  { id: 1004, name: "Jake Soligo", homeState: "VIC" },
  { id: 1005, name: "Izak Rankine", height: 179, weight: 81 },
  { id: 1006, name: "James Peatling", homeState: "NSW" },
  { id: 1008, name: "Ben Keays", homeState: "QLD" },
  { id: 1038, name: "Will Ashcroft", homeState: "VIC", height: 182, weight: 83 },
  { id: 1039, name: "Hugh McCluggage", homeState: "VIC", weight: 86 },
  { id: 1040, name: "Dayne Zorko", homeState: "QLD", height: 175, weight: 78 },
  { id: 1041, name: "Josh Dunkley", homeState: "VIC", height: 191, weight: 87 },
  { id: 1042, name: "Lachie Neale", homeState: "SA", height: 178, weight: 84 },
  { id: 1043, name: "Jaspa Fletcher", height: 184, weight: 76 },
  { id: 1044, name: "Darcy Wilmot", homeState: "VIC", height: 183, weight: 80 },
  { id: 1045, name: "Zac Bailey", homeState: "NT", height: 182, weight: 84 },
  { id: 1046, name: "Levi Ashcroft", homeState: "VIC", height: 179, weight: 81 },
  { id: 1047, name: "Jarrod Berry", homeState: "VIC", height: 192, weight: 89 },
  { id: 1048, name: "Cam Rayner", homeState: "VIC", height: 187, weight: 92 },
  { id: 1049, name: "Harris Andrews", height: 202, weight: 102 },
  { id: 1050, name: "Callum Ah Chee", homeState: "WA", height: 183, weight: 78 },
  { id: 1051, name: "Ryan Lester", homeState: "VIC", height: 192, weight: 88 },
  { id: 1052, name: "Logan Morris", height: 191, weight: 90 },
  { id: 1053, name: "Charlie Cameron", height: 180, weight: 76 },
  { id: 1054, name: "Eric Hipwood", homeState: "QLD", height: 203, weight: 94 },
  { id: 1055, name: "Noah Answerth", homeState: "VIC", height: 183, weight: 82 },
  { id: 1056, name: "Darcy Fort", height: 204, weight: 99 },
  { id: 1057, name: "Darcy Gardiner", height: 193, weight: 91 },
  { id: 1058, name: "Kai Lohmann", homeState: "VIC", height: 185, weight: 79 },
  { id: 1059, name: "Jack Payne", height: 197, weight: 101 },
  { id: 1060, name: "Brandon Starcevich", homeState: "WA", height: 187, weight: 88 },
  { id: 1061, name: "Oscar McInerney", homeState: "VIC", height: 204, weight: 110 },
  { id: 1062, name: "Sam Marshall", homeState: "QLD", height: 185, weight: 79 },
  { id: 1063, name: "Bruce Reville", homeState: "QLD", height: 185, weight: 84 },
  { id: 1064, name: "Sam Day", homeState: "SA", height: 197, weight: 102 },
  { id: 1065, name: "Ty Gallop", homeState: "QLD", height: 194, weight: 89 },
  { id: 1066, name: "Will McLachlan", height: 185, weight: 78 },
  { id: 1067, name: "Conor McKenna", height: 184, weight: 85 },
  { id: 1068, name: "James Tunstill", homeState: "WA", weight: 78 },
  { id: 1069, name: "Keidean Coleman", homeState: "QLD", height: 183, weight: 75 },
  { id: 1070, name: "Deven Robertson", homeState: "WA", height: 185 },
  { id: 1071, name: "Tom Doedee", homeState: "VIC", height: 190, weight: 88 },
  { id: 1072, name: "Henry Smith", homeState: "SA", height: 202, weight: 96 },
  { id: 1073, name: "Luke Beecken", homeState: "SA", height: 184, weight: 77 },
  { id: 1074, name: "George Hewett", homeState: "SA" },
  { id: 1075, name: "Patrick Cripps", height: 195, weight: 93 },
  { id: 1076, name: "Adam Cerra", homeState: "VIC", height: 186, weight: 85 },
  { id: 1077, name: "Oliver Hollands", height: 184, weight: 77 },
  { id: 1078, name: "Nick Haynes", homeState: "VIC", weight: 88 },
  { id: 1079, name: "Tom De Koning", homeState: "VIC", height: 201, weight: 102 },
  { id: 1080, name: "Adam Saad", homeState: "VIC", height: 178, weight: 79 },
  { id: 1081, name: "Sam Walsh", homeState: "VIC", height: 184, weight: 84 },
  { id: 1082, name: "Blake Acres", homeState: "WA", height: 190, weight: 92 },
  { id: 1083, name: "Jacob Weitering", height: 195, weight: 96 },
  { id: 1084, name: "Sam Docherty", height: 187, weight: 85 },
  { id: 1085, name: "Cooper Lord", height: 184, weight: 80 },
  { id: 1086, name: "Zac Williams", homeState: "NSW", height: 185, weight: 84 },
  { id: 1087, name: "Jesse Motlop", homeState: "WA", height: 177, weight: 77 },
  { id: 1088, name: "Mitch McGovern", homeState: "WA", height: 191 },
  { id: 1089, name: "Lachie Fogarty", height: 179, weight: 80 },
  { id: 1090, name: "Charlie Curnow", homeState: "VIC", height: 194, weight: 96 },
  { id: 1091, name: "Matt Carroll", weight: 81 },
  { id: 1092, name: "Lachlan Cowan", homeState: "TAS", height: 188, weight: 81 },
  { id: 1093, name: "Jack Silvagni", homeState: "VIC", height: 194, weight: 88 },
  { id: 1094, name: "Harry McKay", height: 200, weight: 105 },
  { id: 1095, name: "Lewis Young", homeState: "SA", height: 201, weight: 100 },
  { id: 1096, name: "Corey Durdin", homeState: "SA", height: 173, weight: 77 },
  { id: 1097, name: "Will White", height: 177, weight: 74 },
  { id: 1098, name: "Francis Evans", height: 182 },
  { id: 1099, name: "Matthew Cottrell", homeState: "VIC", height: 181, weight: 81 },
  { id: 1100, name: "Elijah Hollands", homeState: "VIC", height: 188, weight: 85 },
  { id: 1101, name: "Jaxon Binns", height: 182 },
  { id: 1102, name: "Marc Pittonet", height: 202, weight: 107 },
  { id: 1103, name: "Flynn Young", height: 179, weight: 75 },
  { id: 1104, name: "Ashton Moir", homeState: "SA", height: 187, weight: 85 },
  { id: 1105, name: "Orazio Fantasia", homeState: "SA", weight: 74 },
  { id: 1106, name: "Harry O'Farrell", height: 193, weight: 88 },
  { id: 1107, name: "Billy Wilson", height: 183, weight: 78 },
  { id: 1108, name: "Brodie Kemp", homeState: "VIC", height: 193, weight: 89 },
  { id: 1109, name: "Alex Cincotta", homeState: "VIC", weight: 83 },
  { id: 1110, name: "Hudson O'Keeffe", homeState: "VIC", height: 202, weight: 98 },
  { id: 1111, name: "Lucas Camporeale", homeState: "SA", height: 185, weight: 76 },
  { id: 1112, name: "Jordan Boyd", height: 182, weight: 81 },
  { id: 1113, name: "Nick Daicos", height: 184 },
  { id: 1114, name: "Josh Daicos", homeState: "VIC", height: 178, weight: 77 },
  { id: 1115, name: "Jack Crisp", homeState: "VIC", height: 190, weight: 91 },
  { id: 1116, name: "Steele Sidebottom", homeState: "VIC", height: 184, weight: 86 },
  { id: 1117, name: "Scott Pendlebury", homeState: "VIC", height: 191, weight: 86 },
  { id: 1118, name: "Ned Long", height: 194, weight: 92 },
  { id: 1119, name: "Darcy Cameron", homeState: "WA", height: 204, weight: 103 },
  { id: 1120, name: "Patrick Lipinski", height: 187, weight: 84 },
  { id: 1121, name: "Harry Perryman", homeState: "NSW", height: 187, weight: 85 },
  { id: 1122, name: "Dan Houston", homeState: "VIC", height: 187, weight: 88 },
  { id: 1123, name: "Isaac Quaynor", height: 180, weight: 84 },
  { id: 1124, name: "Brayden Maynard", height: 189, weight: 93 },
  { id: 1125, name: "Jamie Elliott", height: 178, weight: 80 },
  { id: 1126, name: "Jeremy Howe", homeState: "TAS", height: 190, weight: 86 },
  { id: 1127, name: "Darcy Moore", height: 203, weight: 100 },
  { id: 1128, name: "Lachie Schultz", homeState: "WA", height: 178, weight: 78 },
  { id: 1129, name: "Tim Membrey", height: 188, weight: 93 },
  { id: 1130, name: "Beau McCreery", homeState: "SA", weight: 89 },
  { id: 1131, name: "Brody Mihocek", homeState: "TAS", height: 192, weight: 90 },
  { id: 1132, name: "Daniel McStay", height: 196, weight: 93 },
  { id: 1133, name: "Edward Allan", homeState: "WA", height: 194, weight: 85 },
  { id: 1134, name: "Billy Frampton", homeState: "SA", weight: 95 },
  { id: 1135, name: "Jordan de Goey", height: 188, weight: 89 },
  { id: 1136, name: "Will Hoskin-Elliott", homeState: "VIC", height: 186, weight: 82 },
  { id: 1137, name: "Lachlan Sullivan", homeState: "VIC", height: 178, weight: 80 },
  { id: 1138, name: "Bobby Hill", homeState: "WA", height: 175, weight: 72 },
  { id: 1139, name: "Tom Mitchell", homeState: "VIC", height: 181, weight: 84 },
  { id: 1140, name: "Mason Cox", height: 211, weight: 110 },
  { id: 1141, name: "Oleg Markov", homeState: "SA", height: 188, weight: 82 },
  { id: 1142, name: "Roan Steele", homeState: "WA", height: 184, weight: 81 },
  { id: 1143, name: "Charlie Dean", height: 195, weight: 88 },
  { id: 1144, name: "Wil Parker", height: 180, weight: 80 },
  { id: 1145, name: "Reef McInnes", homeState: "VIC", height: 194, weight: 88 },
  { id: 1146, name: "Will Hayes", height: 181, weight: 78 },
  { id: 1147, name: "Charlie West", homeState: "SA", height: 195, weight: 90 },
  { id: 1758, name: "Harvey Harrison", height: 182, weight: 78 },
  { id: 1773, name: "Oscar Steene", weight: 98 },
  { id: 1779, name: "Angus Anderson", height: 189, weight: 90 },
  { id: 1806, name: "Sam Swadling", height: 187, weight: 81 },
  { id: 1810, name: "Liam Puncher", height: 194, weight: 92 },
  { id: 1822, name: "Noah Howes", weight: 92 },
  { id: 1148, name: "Zach Merrett", height: 179, weight: 83 },
  { id: 1149, name: "Archie Roberts", homeState: "VIC", height: 184, weight: 79 },
  { id: 1150, name: "Andrew McGrath", height: 179 },
  { id: 1151, name: "Sam Durham", height: 185, weight: 83 },
  { id: 1152, name: "Mason Redman", homeState: "SA", height: 187, weight: 87 },
  { id: 1153, name: "Xavier Duursma", height: 186 },
  { id: 1154, name: "Nic Martin", homeState: "WA", height: 192, weight: 88 },
  { id: 1155, name: "Jaxon Prior", homeState: "WA", height: 189, weight: 85 },
  { id: 1156, name: "Dylan Shiel", height: 182, weight: 84 },
  { id: 1157, name: "Archie Perkins", height: 188, weight: 84 },
  { id: 1158, name: "Jye Caldwell", height: 183, weight: 83 },
  { id: 1159, name: "Will Setterfield", height: 192, weight: 89 },
  { id: 1160, name: "Ben Hobbs", height: 183, weight: 80 },
  { id: 1161, name: "Isaac Kako", homeState: "VIC", weight: 72 },
  { id: 1162, name: "Jade Gresham", homeState: "VIC", height: 177, weight: 81 },
  { id: 1163, name: "Peter Wright", weight: 102 },
  { id: 1164, name: "Jayden Laverde", homeState: "VIC", height: 191, weight: 90 },
  { id: 1165, name: "Angus Clarke", homeState: "SA", height: 188, weight: 82 },
  { id: 1166, name: "Todd Goldstein", homeState: "VIC", height: 201, weight: 103 },
  { id: 1167, name: "Nate Caddy", height: 193, weight: 91 },
  { id: 1168, name: "Jordan Ridley", height: 192, weight: 87 },
  { id: 1169, name: "Zach Reid", height: 202, weight: 92 },
  { id: 1170, name: "Zak Johnson", height: 185, weight: 80 },
  { id: 1171, name: "Matt Guelfi", homeState: "WA", height: 184, weight: 81 },
  { id: 1172, name: "Lachlan Blakiston", height: 193, weight: 88 },
  { id: 1173, name: "Luamon Lual", height: 182, weight: 77 },
  { id: 1174, name: "Saad El-Hawli", homeState: "VIC", height: 184, weight: 82 },
  { id: 1175, name: "Kyle Langford", height: 192, weight: 88 },
  { id: 1176, name: "Ben McKay", homeState: "VIC", height: 201, weight: 99 },
  { id: 1177, name: "Darcy Parish", homeState: "VIC", weight: 81 },
  { id: 1178, name: "Elijah Tsatas", homeState: "VIC", height: 187, weight: 83 },
  { id: 1179, name: "Jye Menzie", homeState: "TAS", height: 180, weight: 81 },
  { id: 1180, name: "Harry Jones", homeState: "VIC", height: 196, weight: 88 },
  { id: 1181, name: "Sam Draper", homeState: "SA", weight: 108 },
  { id: 1182, name: "Archie May", homeState: "VIC", height: 193, weight: 88 },
  { id: 1183, name: "Liam McMahon", height: 198, weight: 88 },
  { id: 1184, name: "Archer Day-Wicks", homeState: "VIC", height: 186, weight: 80 },
  { id: 1185, name: "Nick Bryan", homeState: "VIC", height: 203, weight: 98 },
  { id: 1186, name: "Jayden Nguyen", homeState: "VIC", height: 178, weight: 76 },
  { id: 1187, name: "Vigo Visentini", height: 204, weight: 97 },
  { id: 1188, name: "Oskar Smartt", height: 180, weight: 79 },
  { id: 1189, name: "Rhys Unwin", height: 178, weight: 74 },
  { id: 1190, name: "Lewis Hayes", homeState: "VIC", height: 197, weight: 88 },
  { id: 1191, name: "Tom Edwards", height: 176, weight: 73 },
  { id: 1192, name: "Caleb Serong", homeState: "VIC", height: 179, weight: 83 },
  { id: 1193, name: "Andrew Brayshaw", height: 185, weight: 88 },
  { id: 1194, name: "Jordan Clark", homeState: "WA", height: 185, weight: 82 },
  { id: 1195, name: "Luke Ryan", height: 186, weight: 92 },
  { id: 1196, name: "Shai Bolton", homeState: "WA", height: 175, weight: 78 },
  { id: 1197, name: "Luke Jackson", homeState: "WA", height: 199, weight: 102 },
  { id: 1198, name: "Murphy Reid", homeState: "VIC", height: 181, weight: 78 },
  { id: 1199, name: "Matthew Johnson", homeState: "WA", height: 192, weight: 86 },
  { id: 1200, name: "Karl Worner", homeState: "VIC", height: 188, weight: 85 },
  { id: 1201, name: "Heath Chapman", homeState: "WA", height: 193, weight: 87 },
  { id: 1202, name: "Bailey Banfield", height: 190, weight: 88 },
  { id: 1203, name: "Josh Treacy", height: 195, weight: 99 },
  { id: 1204, name: "Michael Frederick", homeState: "SA", height: 183, weight: 78 },
  { id: 1205, name: "Neil Erasmus", height: 190, weight: 88 },
  { id: 1206, name: "Brennan Cox", homeState: "SA", height: 195, weight: 96 },
  { id: 1207, name: "Corey Wagner", homeState: "QLD", height: 181, weight: 82 },
  { id: 1208, name: "Jaeger O'Meara", height: 184, weight: 83 },
  { id: 1209, name: "Nathan O'Driscoll", homeState: "WA", height: 187, weight: 82 },
  { id: 1210, name: "Sam Switkowski", homeState: "VIC", height: 178, weight: 74 },
  { id: 1211, name: "Patrick Voss", homeState: "VIC", height: 194, weight: 98 },
  { id: 1212, name: "Jeremy Sharp", weight: 81 },
  { id: 1213, name: "Alex Pearce", homeState: "TAS", height: 201, weight: 98 },
  { id: 1214, name: "Jye Amiss", homeState: "WA", height: 196, weight: 88 },
  { id: 1215, name: "Sean Darcy", homeState: "VIC", height: 201, weight: 110 },
  { id: 1216, name: "Hayden Young", homeState: "VIC", height: 189, weight: 88 },
  { id: 1217, name: "Isaiah Dudley", homeState: "SA", height: 168, weight: 73 },
  { id: 1218, name: "Josh Draper", homeState: "WA", height: 197, weight: 93 },
  { id: 1219, name: "Oscar McDonald", height: 196, weight: 96 },
  { id: 1220, name: "Nat Fyfe", height: 192, weight: 92 },
  { id: 1221, name: "Cooper Simpson", homeState: "VIC", height: 182, weight: 79 },
  { id: 1222, name: "James Aish", homeState: "SA", weight: 83 },
  { id: 1223, name: "Brandon Walker", height: 183, weight: 80 },
  { id: 1224, name: "Quinton Narkle", height: 182, weight: 81 },
  { id: 1225, name: "Liam Reidy", homeState: "VIC", height: 204, weight: 104 },
  { id: 1738, name: "Sam Sturt", homeState: "VIC", height: 190, weight: 81 },
  { id: 1745, name: "Michael Walters", height: 177, weight: 79 },
  { id: 1825, name: "Tobyn Murray", height: 182, weight: 80 },
];

type PersonalityField = "leadership" | "goHomeTend" | "loyaltyTend" | "injuryTend" | "disiciplineOffFirned";
const PERSONALITY_FIXES: { id: number; name: string; field: PersonalityField; value: number; why: string }[] = [
  { id: 1001, name: "Jordan Dawson", field: "leadership", value: 95, why: "Adelaide captain, 2026 AFLPA Best Captain" },
  { id: 1001, name: "Jordan Dawson", field: "goHomeTend", value: 5, why: "SA native who traded home to Adelaide" },
  { id: 1004, name: "Jake Soligo", field: "loyaltyTend", value: 80, why: "signed extension through 2029" },
  { id: 1006, name: "James Peatling", field: "disiciplineOffFirned", value: 80, why: "no off-field incidents on record" },
  { id: 1007, name: "Wayne Milera", field: "injuryTend", value: 90, why: "WPW heart surgery, patella ruptures, recurring soft tissue" },
  { id: 1049, name: "Harris Andrews", field: "leadership", value: 92, why: "Brisbane co-captain" },
  { id: 1042, name: "Lachie Neale", field: "leadership", value: 90, why: "Brisbane co-captain" },
  { id: 1075, name: "Patrick Cripps", field: "leadership", value: 95, why: "Carlton captain" },
  { id: 1117, name: "Scott Pendlebury", field: "leadership", value: 98, why: "longest-serving Collingwood captain" },
  { id: 1116, name: "Steele Sidebottom", field: "leadership", value: 90, why: "premiership veteran, 300+ games" },
  { id: 1127, name: "Darcy Moore", field: "leadership", value: 95, why: "Collingwood premiership captain" },
  { id: 1124, name: "Brayden Maynard", field: "leadership", value: 88, why: "Collingwood leadership group" },
  { id: 1148, name: "Zach Merrett", field: "leadership", value: 92, why: "Essendon captain" },
  { id: 1213, name: "Alex Pearce", field: "leadership", value: 90, why: "Fremantle captain" },
];

const ARCHETYPE_FIXES: { id: number; name: string; archetype: Archetype; reason: string }[] = [
  { id: 1002, name: "Rory Laird", archetype: "Inside Mid", reason: "contested extraction/handball-chain inside mid, not an outside mid" },
  { id: 1049, name: "Harris Andrews", archetype: "Key Defender", reason: "202cm key defender" },
  { id: 1053, name: "Charlie Cameron", archetype: "Small Forward", reason: "180cm small pressure forward" },
  { id: 1108, name: "Brodie Kemp", archetype: "Key Defender", reason: "193cm key defender / tall utility" },
  { id: 1125, name: "Jamie Elliott", archetype: "Small Forward", reason: "178cm small/medium pressure forward" },
  { id: 1128, name: "Lachie Schultz", archetype: "Small Forward", reason: "178cm small forward" },
  { id: 1180, name: "Harry Jones", archetype: "Key Forward", reason: "196cm key forward" },
];

/**
 * `loadPopulation` appends ATTRIBUTE_OVERRIDE_COLUMN to its in-memory header when the on-disk CSV lacks
 * it (Round C158 stripped it), and `writeSingleRow` then syncs that header to disk while only the
 * edited rows gain the trailing field — leaving every other row one field short. None of this round's
 * edits set an override (`revertToFormula` writes false), so drop the column again to keep the file's
 * shape identical to before this script ran. Only lines carrying the extra trailing field are touched.
 */
function stripAddedOverrideColumn(): void {
  const lines = readFileSync(CSV_PATH, "utf-8").split("\n");
  const header = lines[0].split(",");
  if (header[header.length - 1] !== ATTRIBUTE_OVERRIDE_COLUMN) return;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const fields = parseCsv(lines[i])[0];
    if (fields.length !== header.length) continue;
    const value = fields[fields.length - 1];
    if (value !== "" && value !== "0") throw new Error(`Row ${i} has ${ATTRIBUTE_OVERRIDE_COLUMN}=${value}; refusing to strip a real override`);
    lines[i] = lines[i].slice(0, lines[i].lastIndexOf(","));
  }
  lines[0] = header.slice(0, -1).join(",");
  writeFileSync(CSV_PATH, lines.join("\n"));
}

function main() {
  const headerHadOverrideColumn = readFileSync(CSV_PATH, "utf-8").split("\n")[0].split(",").includes(ATTRIBUTE_OVERRIDE_COLUMN);
  const pop = loadPopulation();
  // Every fix is keyed by PlayerID AND checked against the name, so a renumbered CSV fails loudly.
  const get = (id: number, name: string): Player => {
    const p = findPlayer(pop, id);
    if (!p || `${p.fname} ${p.lname}` !== name) throw new Error(`PlayerID ${id} is not ${name} (found ${p ? `${p.fname} ${p.lname}` : "nothing"})`);
    return p;
  };
  const replace = (updated: Player) => {
    pop.players[pop.players.findIndex((pl) => pl.PlayerID === updated.PlayerID)] = updated;
    writeSingleRow(updated.PlayerID, pop.header, updated as unknown as Record<string, unknown>);
  };

  for (const f of BIO_FIXES) {
    get(f.id, f.name);
    const { id: _id, name: _name, ...changes } = f;
    saveMetadata(pop, f.id, changes);
  }
  console.log(`Bio corrections: ${BIO_FIXES.length} players`);

  for (const f of PERSONALITY_FIXES) {
    const p = get(f.id, f.name);
    console.log(`Personality: ${f.name} ${f.field} ${p[f.field]} -> ${f.value} (${f.why})`);
    replace({ ...p, [f.field]: f.value });
  }

  for (const f of ARCHETYPE_FIXES) {
    const p = get(f.id, f.name);
    const old = { archetype: p.archetype, OVR: p.OVR, POT: p.POT };
    replace({ ...p, archetype: f.archetype, archetype_reason: `Manual reclassification (round C162 club audit): ${f.reason}` });
    const { player } = revertToFormula(pop, f.id);
    console.log(`Archetype: ${f.name} ${old.archetype} -> ${player.archetype}: OVR ${old.OVR} -> ${player.OVR}, POT ${old.POT} -> ${player.POT}`);
  }

  if (!headerHadOverrideColumn) stripAddedOverrideColumn();
}

main();
