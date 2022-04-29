import { CrimeStats, NS } from "@ns";
import { getNsData } from "/modules/helper";

interface CrimeInfo {
  name: string;
  stats: CrimeStats;
  chance: number;
}

const crimeNames = [
  "Shoplift",
  "Rob store",
  "Mug someone",
  "Larceny",
  "Deal Drugs",
  "Bond Forgery",
  "Traffick illegal Arms",
  "Homicide",
  "Grand theft Auto",
  "Kidnap and Ransom",
  "Assassinate",
  "Heist",
];

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["loop", true],
    ["crimeChanceFactor", 1.5],
    ["crimeTimeFactor", 1.05],
  ]);

  ns.disableLog("ALL");

  // punish slightly for lower chance crimes
  const getInc = (ci: CrimeInfo) =>
    (Math.pow(ci.chance, args["crimeChanceFactor"]) * ci.stats.money) /
    Math.pow(ci.stats.time, args["crimeTimeFactor"]);

  do {
    // get crime data
    const crimes = (await getNsData(
      ns,
      "JSON.parse(ns.args[0]).map((n)=>{return {name: n,stats: ns.getCrimeStats(n),chance: ns.getCrimeChance(n)}})",
      "/temp/crime-info",
      [JSON.stringify(crimeNames)]
    )) as CrimeInfo[];
    // ns.print(crimes);

    // select crime with highest expected income per sec
    crimes.sort((a, b) => getInc(b) - getInc(a));
    // `${i.name}: ${i.stats.money/i.stats.time} @ ${(i.chance*100).toFixed(2)}%`
    ns.print(crimes.map((i) => `${i.name}: ${getInc(i)}`));

    ns.commitCrime(crimes[0].name);

    await ns.asleep(crimes[0].stats.time);
  } while (args["loop"]);
}
