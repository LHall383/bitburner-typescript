import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["target", "n00dles"],
    ["minRam", 4],
    ["maxRam", ns.getPurchasedServerMaxRam()],
    ["budget", 0.8],
  ]);

  ns.disableLog("ALL");
  ns.print("----------Staring upgrade servers----------");

  const scriptName = "/scripts/basic-hack.js";
  const scriptRam = ns.getScriptRam(scriptName);
  const maxMinutesPerLevel = 10;

  // loop through with increasing amounts of ram
  for (let ram = args["minRam"]; ram <= args["maxRam"]; ram *= 2) {
    const servers = ns.getPurchasedServers();
    const threads = Math.floor(ram / scriptRam);
    const cost = ns.getPurchasedServerCost(ram);
    ns.print(`Upgrading to ${ram} ram. Running ${threads} threads.`);

    // if it will take too long to upgrade all servers, exit now
    const income = Math.max(ns.getScriptIncome()[0]);
    const upgradeLevelCost = cost * servers.length;
    const earnedIncome = income * maxMinutesPerLevel * 60;
    if (upgradeLevelCost > earnedIncome + ns.getPlayer().money) {
      ns.print(`Upgrade will take ${ns.nFormat(upgradeLevelCost, "$0.0a")}.`);
      ns.print(
        `Only earn ${ns.nFormat(
          earnedIncome,
          "$0.0a"
        )} in ${maxMinutesPerLevel}min.`
      );
      break;
    }

    // loop through purchased servers and upgrade them to the provided amount of ram
    const startTime = Date.now();
    for (let i = 0; i < servers.length; i++) {
      const s = servers[i];

      // if already at current ram level, skip
      const sRam = ns.getServerMaxRam(s);
      if (sRam >= ram) continue;

      // wait for the money
      ns.printf(
        "Waiting for money to upgrade '%s'. Will spend $%s at $%s",
        s,
        cost.toLocaleString("en-US"),
        (cost / args["budget"]).toLocaleString("en-US")
      );
      const time = Date.now() - startTime;
      ns.print(
        `Has spent ${(time / 1000 / 60).toFixed(
          2
        )} minutes upgrading to ${ram} so far`
      );
      while (ns.getServerMoneyAvailable("home") * args["budget"] <= cost) {
        await ns.sleep(10000);
      }

      // upgrade server
      ns.killall(s);
      ns.deleteServer(s);
      ns.purchaseServer(s, ram);

      // copy script to server
      await ns.scp(scriptName, s);

      // start maximum number of threads running script
      ns.exec(scriptName, s, threads, "--target", args["target"]);
      ns.print("Started " + threads + " threads of hack on server: " + s);
    }
    ns.print(`All servers up to ${ram} ram`);
    ns.toast(`All servers up to ${ram} ram`);

    await ns.sleep(1);
  }

  ns.print("Finished upgrading servers!");
  ns.toast("Finished upgrading servers!", "info", 5000);
  const p1Handle = ns.getPortHandle(1);
  p1Handle.tryWrite(
    JSON.stringify({
      source: "upgrade-servers",
      exiting: true,
      message: `upgrade-servers exiting`,
    })
  );
}
