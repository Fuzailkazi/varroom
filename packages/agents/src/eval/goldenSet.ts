import type { ClaimType } from "../types.ts";

// A claim expected to be extracted from a debate.
export type ExpectedClaim = {
	order: number;
	claimText: string;
	type: ClaimType;
	testable: boolean;
	expectedVerdict?:
		| "VERIFIED"
		| "PARTIALLY_TRUE"
		| "REFUTED"
		| "INSUFFICIENT_DATA"
		| "UNTESTABLE";
};

// One real football debate in the golden eval set.
export type GoldenDebate = {
	id: string;
	title: string;
	thesis: string;
	expectedClaims: ExpectedClaim[];
	roughExpectedVerdict: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";
	category:
		| "POSITIONAL_ROLE"
		| "COMPARISON"
		| "TEAM_TACTIC"
		| "TRANSFER_FIT"
		| "MIXED"
		| "UNTESTABLE";
};

// 21 real football debate opinions covering multiple leagues, clubs, and claim types.
export const GOLDEN_DEBATES: GoldenDebate[] = [
	{
		id: "golden-01",
		title: "Jude Bellingham is more effective as a false 9 than as an 8",
		thesis:
			"When Bellingham plays as a false 9 or advanced 10 for Real Madrid, he scores far more goals and gets into the box more often than when he is deployed deeper as a central midfielder.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText: "Bellingham is more effective as a false 9 than as an 8",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-02",
		title:
			"Trent Alexander-Arnold is defensively exposed as an inverted fullback compared to a traditional right back",
		thesis:
			"Trent gets caught out of position when inverting into midfield compared to staying wide as a traditional fullback.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Trent Alexander-Arnold is more defensively exposed as an inverted fullback than as a traditional right back",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-03",
		title:
			"Erling Haaland scores more non-penalty goals per 90 than Kylian Mbappe in the Champions League",
		thesis:
			"Haaland has a distinctly superior non-penalty goal per 90 ratio in UEFA Champions League matches than Mbappe.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Haaland has a higher non-penalty goal per 90 ratio than Mbappe in the Champions League",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-04",
		title:
			"William Saliba wins a higher percentage of ground duels than Gabriel Magalhaes",
		thesis:
			"Saliba's ground duel win rate in the Premier League is consistently higher than Gabriel's.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Saliba has a higher ground duel win percentage than Gabriel in the Premier League",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-05",
		title: "Rodri completes more progressive passes per 90 than Declan Rice",
		thesis:
			"In domestic league football, Rodri consistently generates more progressive passes per 90 minutes than Declan Rice.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Rodri completes more progressive passes per 90 than Declan Rice",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-06",
		title:
			"Arsenal concede fewer shots on target per match than Manchester City",
		thesis:
			"Arsenal's defensive structure limits opponents to fewer shots on target per 90 than Manchester City's defense.",
		category: "TEAM_TACTIC",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Arsenal concede fewer shots on target per match than Manchester City",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-07",
		title:
			"Liverpool press with higher intensity under Arne Slot than under Jurgen Klopp",
		thesis:
			"Arne Slot's Liverpool team presses with a higher PPDA and more final third turnovers than Klopp's team did.",
		category: "TEAM_TACTIC",
		roughExpectedVerdict: "OVERTURNED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Liverpool press with higher intensity under Arne Slot than under Jurgen Klopp",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "REFUTED",
			},
		],
	},
	{
		id: "golden-08",
		title:
			"Real Madrid concede more counter-attacking chances playing a 4-3-3 compared to a 4-4-2 diamond",
		thesis:
			"When playing a front three in a 4-3-3, Real Madrid concede more counter-attacks than with a compact 4-4-2 diamond.",
		category: "TEAM_TACTIC",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Real Madrid concede more counter-attacks in a 4-3-3 than in a 4-4-2",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-09",
		title:
			"Kai Havertz generates more expected goals per 90 as a striker than as an attacking midfielder",
		thesis:
			"At Arsenal, Kai Havertz produces significantly more xG per 90 playing as a central striker compared to when he started as a left-sided number 8.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Kai Havertz generates more xG per 90 as a centre forward than as an attacking midfielder",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-10",
		title:
			"Viktor Gyokeres has a higher shot conversion rate than Nicolas Jackson",
		thesis:
			"Gyokeres finishes a higher percentage of his total shots into goals across all competitions than Nicolas Jackson.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Viktor Gyokeres has a higher shot conversion rate than Nicolas Jackson",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-11",
		title:
			"Cole Palmer creates more chances when starting in the central 10 role than on the right wing",
		thesis:
			"Cole Palmer's key pass and chance creation volume is higher when playing centrally than when deployed wide right.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Cole Palmer creates more chances centrally as a 10 than on the right wing",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-12",
		title:
			"Manchester United concede more cutback opportunities than most Premier League clubs",
		thesis:
			"Erik ten Hag's tactical setup allows an unusually high number of cutback crosses into the penalty box.",
		category: "TEAM_TACTIC",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Manchester United concede more cutback chances than league average",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-13",
		title:
			"Antoine Griezmann makes more defensive recoveries as a central midfielder than as a forward",
		thesis:
			"When playing as an 8 or interior for France, Griezmann averages more tackles and recoveries per 90 than as a forward for Atletico.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Antoine Griezmann makes more defensive recoveries as a central midfielder than as a forward",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-14",
		title:
			"Bukayo Saka completes more progressive carries per 90 than Phil Foden",
		thesis:
			"Bukayo Saka averages more progressive carries into the penalty area per 90 minutes than Phil Foden in league matches.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Bukayo Saka averages more progressive carries per 90 than Phil Foden",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-15",
		title:
			"Barcelona play with a higher offside trap line under Hansi Flick than under Xavi",
		thesis:
			"Hansi Flick's Barcelona team catches opponents offside more times per match with an aggressive high defensive line than Xavi's team did.",
		category: "TEAM_TACTIC",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Barcelona catch opponents offside more under Hansi Flick than under Xavi",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-16",
		title:
			"Anthony Gordon completes more defensive pressing sprints than Marcus Rashford",
		thesis:
			"Gordon's off-the-ball sprint volume and pressing actions in the Premier League exceed Rashford's by a wide margin.",
		category: "COMPARISON",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Anthony Gordon completes more defensive pressing sprints than Marcus Rashford",
				type: "COMPARISON",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-17",
		title:
			"Viktor Gyokeres has the physical profile and box movement to suit Arsenal's system",
		thesis:
			"Gyokeres' high box touch numbers and physical hold up play match what Arteta requires from a number 9.",
		category: "TRANSFER_FIT",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Gyokeres has high penalty box touches and hold up profile fitting Arsenal",
				type: "TRANSFER_FIT",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
		],
	},
	{
		id: "golden-18",
		title:
			"The referee in the 2009 Chelsea vs Barcelona match was corrupted by UEFA",
		thesis:
			"Tom Henning Ovrebo intentionally rigged the 2009 semifinal because UEFA did not want an all-English final.",
		category: "UNTESTABLE",
		roughExpectedVerdict: "INCONCLUSIVE",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"UEFA corrupted the referee in the 2009 Champions League semifinal",
				type: "UNTESTABLE",
				testable: false,
				expectedVerdict: "UNTESTABLE",
			},
		],
	},
	{
		id: "golden-19",
		title:
			"Real Madrid has greater aura and intangible spiritual energy on European nights than Manchester City",
		thesis:
			"The magical heritage and stadium soul of the Bernabeu creates an unbeatable mystic energy that numbers cannot quantify.",
		category: "UNTESTABLE",
		roughExpectedVerdict: "INCONCLUSIVE",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Real Madrid has unmatched aura and mystical energy in Europe",
				type: "UNTESTABLE",
				testable: false,
				expectedVerdict: "UNTESTABLE",
			},
		],
	},
	{
		id: "golden-20",
		title:
			"Alphonso Davies wins more recovery duels as an attacking wing-back than in a rigid back four",
		thesis:
			"Davies performs better defensively when given freedom to press forward as a wing-back rather than sitting deep in a flat back four.",
		category: "POSITIONAL_ROLE",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Alphonso Davies wins more recovery duels as a wing-back than in a flat back four",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "PARTIALLY_TRUE",
			},
		],
	},
	{
		id: "golden-21",
		title:
			"Bukayo Saka is better on the right wing than at left wing-back, Arsenal have a better defense than Spurs, and Arsenal fans are the most passionate",
		thesis:
			"Saka is far more productive attacking from the right than defending at left back. Defensively, Arsenal allow fewer goals per game than Tottenham. And Arsenal supporters have the greatest passion in England.",
		category: "MIXED",
		roughExpectedVerdict: "CONFIRMED",
		expectedClaims: [
			{
				order: 1,
				claimText:
					"Saka is more productive as a right winger than as a left wing-back",
				type: "POSITIONAL_ROLE",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
			{
				order: 2,
				claimText: "Arsenal concede fewer goals per game than Tottenham",
				type: "TEAM_TACTIC",
				testable: true,
				expectedVerdict: "VERIFIED",
			},
			{
				order: 3,
				claimText: "Arsenal supporters have the greatest passion in England",
				type: "UNTESTABLE",
				testable: false,
				expectedVerdict: "UNTESTABLE",
			},
		],
	},
];
