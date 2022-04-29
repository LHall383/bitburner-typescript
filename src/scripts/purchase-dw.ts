import { NS } from "@ns";
import { customGetStats, getNsData } from "/modules/helper";

export async function main(ns: NS): Promise<void> {
  ns.print("--------------------Starting script--------------------");
  ns.disableLog("ALL");

  let stats = await customGetStats(ns);

  // purchase TOR router
  do {
    const purchased = (await getNsData(
      ns,
      "ns.purchaseTor()",
      "/temp/tor"
    )) as boolean;
    ns.print(`TOR Router ${purchased ? "successfully" : "not"} purchased`);

    await ns.asleep(1000);
    stats = await customGetStats(ns);
  } while (!stats.player.tor);

  // purchase all port opening programs
  const programs = [
    "BruteSSH.exe",
    "FTPCrack.exe",
    "RelaySMTP.exe",
    "HTTPWorm.exe",
    "SQLInject.exe",
  ];
  for (const p of programs) {
    let purchased = await getNsData(
      ns,
      `ns.purchaseProgram('${p}')`,
      `/temp/purchase-program`
    );
    while (!purchased) {
      await ns.asleep(5000);
      purchased = await getNsData(
        ns,
        `ns.purchaseProgram('${p}')`,
        `/temp/purchase-program`
      );
    }
    ns.print(`Purchased: ${p}`);
  }
}
