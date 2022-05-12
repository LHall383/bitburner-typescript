import { NS } from "@ns";
import { getNsData } from "/modules/helper";

export async function main(ns: NS): Promise<void> {
  ns.print("--------------------Starting script--------------------");
  ns.disableLog("ALL");

  const blacklist = [
    "Sector-12",
    "Aevum",
    "Volhaven",
    "Chongqing",
    "New Tokyo",
    "Ishima",
  ];

  while (true) {
    const factionInvites = (await getNsData(
      ns,
      "ns.checkFactionInvitations()",
      "/temp/check-faction-invites"
    )) as string[];

    const factionsToJoin = factionInvites.filter((f) => !blacklist.includes(f));
    if (factionsToJoin.length > 0) {
      ns.print(`Joining: ${factionsToJoin}`);
      const joined = await getNsData(
        ns,
        "JSON.parse(ns.args[0]).map(f=>ns.joinFaction(f))",
        "/temp/join-factions",
        [JSON.stringify(factionsToJoin)]
      );
      ns.print(`Join result: ${joined}`);
    }

    await ns.asleep(5000);
  }
}
