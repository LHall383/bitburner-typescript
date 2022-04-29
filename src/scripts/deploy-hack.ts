import { NS } from "@ns";
import { scanServers } from "/modules/helper";

const basicHackScript = "/scripts/basic-hack.js";

export async function main(ns: NS): Promise<void> {
  // parse command line args
  const args = ns.flags([
    ["target", "n00dles"],
    ["deployToPserv", false],
    ["restart", false],
  ]);

  // seed server list
  const serverList = await scanServers(ns, true, !args["deployToPserv"]);
  ns.print(serverList);

  // wait at least 5 seconds so nuke-servers has done its job
  await ns.asleep(10000);

  // calc RAM used by script
  const scriptRam = ns.getScriptRam(basicHackScript);

  // start scripts on each server in list
  for (const server of serverList) {
    // delay a bit each loop to not lock up
    await ns.sleep(1);

    // verify that server actually exists
    if (ns.serverExists(server) === false) {
      ns.print("Not a valid server: " + server);
      continue;
    }

    // if this is the home server, don't deploy
    if (server === "home") {
      ns.print("Skipping home server");
      continue;
    }

    // if we don't have root access, exit here
    if (ns.hasRootAccess(server) === false) {
      ns.print("No root access on: " + server);
      continue;
    }

    // kill all currently running versions of the hack script
    if (args["restart"]) {
      ns.printf("Restarting hacks on server: %s", server);
      ns.killall(server);
    }

    // copy script to server
    await ns.scp(basicHackScript, server);

    // start maximum number of threads running script
    const ram = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
    const threads = Math.floor(ram / scriptRam);
    if (threads > 0) {
      ns.exec(basicHackScript, server, threads, "--target", args["target"]);
      ns.printf("Started %i threads of hack on server: %s", threads, server);
    } else {
      ns.printf("Not enough ram for a thread on server: %s", server);
    }
  }
}
