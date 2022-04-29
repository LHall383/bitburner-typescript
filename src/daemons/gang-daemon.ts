import { EquipmentStats, GangGenInfo, GangMemberInfo, NS, Player } from "@ns";
import { getNsData } from "/modules/helper";

interface EquipmentInfo {
  name: string;
  cost: number;
  type: string;
  stats: EquipmentStats;
}

const maxEquipmentBudget = 0.25;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["loop", true]]);

  ns.disableLog("ALL");
  ns.print("----------Staring gang daemon----------");

  do {
    // update gang stats
    const gang = (await getNsData(
      ns,
      "ns.gang.getGangInformation()",
      "/temp/gang-info"
    )) as GangGenInfo;

    // update player stats
    const player = (await getNsData(
      ns,
      "ns.getPlayer()",
      "/temp/get-player",
      [],
      1000
    )) as Player;

    // update gang member data
    const members = (await getNsData(
      ns,
      "Object.fromEntries(ns.gang.getMemberNames().map((n)=>[n, ns.gang.getMemberInformation(n)]))",
      "/temp/gang-members"
    )) as Record<string, GangMemberInfo>;
    let memberCount = Object.keys(members).length;

    // recruit new members and start them training combat/hacking
    let mName = `BIGDAWG${memberCount}`;
    const activity = gang.isHacking ? "Train Hacking" : "Train Combat";
    while (
      await getNsData(
        ns,
        "ns.gang.recruitMember(ns.args[0])",
        "/temp/gang-recruit-member",
        [mName]
      )
    ) {
      const added = (await getNsData(
        ns,
        "ns.gang.setMemberTask(ns.args[0], ns.args[1])",
        "/temp/gang-set-task",
        [mName, activity]
      )) as boolean;
      ns.print(
        `Recruited ${mName} and ` +
          (added ? `set to ${activity}` : `not successfully assigned a task`)
      );

      memberCount++;
      mName = `BIGDAWG${memberCount}`;
      await ns.asleep(10);
    }

    // update equipment data
    const equipment = (await getNsData(
      ns,
      "ns.gang.getEquipmentNames().map((name) => { return { name, cost: ns.gang.getEquipmentCost(name), type: ns.gang.getEquipmentType(name), stats: ns.gang.getEquipmentStats(name) } })",
      "/temp/gang-equipment"
    )) as EquipmentInfo[];

    // Purchase equipment if its less than a threshold of our total money
    const threshold = (player.money * maxEquipmentBudget) / memberCount;
    // ns.print(threshold);
    const equipAffordable = _.filter(equipment, (e) => e.cost < threshold);
    // ns.print(equipAffordable);
    const equipToBuy = [] as [string, string][];

    Object.keys(members).forEach((name) => {
      const info = members[name];
      const mEquip = [...info.upgrades, ...info.augmentations];
      // ns.print(`${name}: ${mEquip}`);

      const toBuy = _.filter(
        equipAffordable,
        (e) => !mEquip.includes(e.name)
      ).map((e) => {
        return [name, e.name] as [string, string];
      });
      equipToBuy.push(...toBuy);
    });

    if (equipToBuy.length > 0) {
      ns.print(`Will be purchasing ${equipToBuy}`);
      (await getNsData(
        ns,
        "JSON.parse(ns.args[0]).map(([mName, eName])=>{ns.gang.purchaseEquipment(mName, eName)})",
        "/temp/gang-purchase-equipment",
        [JSON.stringify(equipToBuy)]
      )) as boolean[];
    }

    await ns.asleep(1000);
  } while (args["loop"]);
}
