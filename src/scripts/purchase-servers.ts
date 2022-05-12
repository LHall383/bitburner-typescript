import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["target", "n00dles"],
    ["upgrade", false],
    ["budget", 0.8],
  ]);

  const startingRam = 8;
  const scriptName = "/scripts/basic-hack.js";
  const scriptRam = ns.getScriptRam(scriptName);

  // start with the number of current servers so we don't overbuy
  const servers = ns.getPurchasedServers();
  for (let i = servers.length; i < ns.getPurchasedServerLimit(); i++) {
    const server = "pserv-" + i;
    ns.print(
      `Next server cost will be: ${ns.getPurchasedServerCost(
        startingRam
      )}, will purchase at: ${
        ns.getPurchasedServerCost(startingRam) * args["budget"]
      }`
    );
    while (
      ns.getPurchasedServerCost(startingRam) >
      ns.getServerMoneyAvailable("home") * args["budget"]
    ) {
      await ns.sleep(3000);
    }

    // make the purchase
    ns.purchaseServer(server, startingRam);

    // kill all currently running versions of the hack script
    ns.scriptKill(scriptName, server);

    // copy script to server
    await ns.scp(scriptName, server);

    // start maximum number of threads running script
    const ramAvailable =
      ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
    const threads = Math.floor(ramAvailable / scriptRam);
    ns.exec(scriptName, server, threads, "--target", args["target"]);
    ns.print("Started " + threads + " threads of hack on server: " + server);
  }

  ns.print("Finished purchasing servers!");
  ns.toast("Finished purchasing servers!", "info", 5000);
  const p1Handle = ns.getPortHandle(1);
  p1Handle.tryWrite(
    JSON.stringify({
      source: "purchase-servers",
      exiting: true,
      message: `purchase-servers exiting`,
    })
  );

  if (args["upgrade"]) {
    ns.spawn("/scripts/upgrade-servers.js", 1, "--target", args["target"]);
  }
}
