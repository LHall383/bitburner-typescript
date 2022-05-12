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
    ["prioritizeKarma", true],
    ["crimeChanceFactor", 1.75],
    ["crimeTimeFactor", 1.0],
  ]);

  ns.disableLog("ALL");

  // punish slightly for lower chance crimes
  const getPrio = (ci: CrimeInfo) =>
    (Math.pow(ci.chance, args["crimeChanceFactor"]) *
      (args["prioritizeKarma"] ? ci.stats.karma : ci.stats.money)) /
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

    // select crime with highest priority
    crimes.sort((a, b) => getPrio(b) - getPrio(a));
    ns.print(crimes.map((i) => `${i.name}: ${getPrio(i)}`));

    ns.commitCrime(crimes[0].name);
    await ns.asleep(crimes[0].stats.time);
  } while (args["loop"]);
}
