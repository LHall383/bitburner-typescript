import { NS } from "@ns";
import {
  connectToSever,
  customGetStats,
  getNsData,
  scanServers,
} from "/modules/helper";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    [
      "backdoor",
      ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z", "fulcrumassets"],
    ],
  ]);

  ns.print("--------------------Starting script--------------------");
  ns.disableLog("ALL");

  // programs used to open ports
  const programs = [
    "BruteSSH",
    "FTPCrack",
    "RelaySMTP",
    "HTTPWorm",
    "SQLInject",
  ];
  const filename = (p: string) => `${p}.exe`;
  const funcName = (p: string) => `ns.${p.toLowerCase()}`;

  // macro for checking if we own a program
  const exists = async (filename: string) =>
    (await getNsData(
      ns,
      `ns.fileExists('${filename}', 'home')`,
      "/temp/file-exists"
    )) as boolean;

  // server stats to track which still need to be cracked
  let serverList = await scanServers(ns, true, true);
  let stats = await customGetStats(ns, [...serverList]);
  let toNuke = _.filter(
    serverList,
    (s) => stats.servers[s] && !stats.servers[s].hasAdminRights
  );
  let toBackdoor = _.filter(
    args["backdoor"] as string[],
    (s) => stats.servers[s] && !stats.servers[s].backdoorInstalled
  );
  // ns.print(`Server List: ${serverList}`);

  while (toNuke.length > 0 || toBackdoor.length > 0) {
    // update server stats
    serverList = await scanServers(ns, true, true);
    stats = await customGetStats(ns, [...serverList]);
    toNuke = _.filter(
      serverList,
      (s) => stats.servers[s] && !stats.servers[s].hasAdminRights
    );
    toBackdoor = _.filter(
      args["backdoor"] as string[],
      (s) => stats.servers[s] && !stats.servers[s].backdoorInstalled
    );

    ns.print(`Remaining to NUKE: ${toNuke}`);
    ns.print(`Remaining to backdoor: ${toBackdoor}`);

    // run each program on each server left to nuke and backdoor
    for (const p of programs) {
      if (!(await exists(filename(p)))) continue;
      await getNsData(
        ns,
        `JSON.parse(ns.args[0]).map(s=>${funcName(p)}(s))`,
        `/temp/${p}`,
        [JSON.stringify([...toNuke, ...toBackdoor])]
      );
    }

    // if we can nuke, do it now
    const canNuke = _.filter(
      toNuke,
      (s) =>
        stats.servers[s].openPortCount >= stats.servers[s].numOpenPortsRequired
    );
    if (canNuke.length > 0) {
      ns.print(`Nuking: ${canNuke}`);
      await getNsData(
        ns,
        `JSON.parse(ns.args[0]).map(s=>ns.nuke(s))`,
        "/temp/nuke",
        [JSON.stringify(canNuke)]
      );
    }

    // if we can backdoor, do it now
    const canBackdoor = _.filter(
      toBackdoor,
      (s) =>
        stats.servers[s].hasAdminRights &&
        stats.servers[s].requiredHackingSkill <= stats.player.hacking
    );
    if (canBackdoor.length > 0) {
      ns.print(`Backdooring: ${canBackdoor}`);
      for (const s of canBackdoor) {
        // navigate to the server
        const toServer = await connectToSever(ns, s);
        ns.print(`Path to server: ${toServer}`);

        const connected = (await getNsData(
          ns,
          "JSON.parse(ns.args[0]).map(s=>ns.connect(s))",
          "/temp/connect",
          [JSON.stringify(toServer)]
        )) as boolean[];
        const success =
          connected && connected.length > 0 && connected.every((i) => i);
        ns.print(`Navigated successfully: ${success}`);

        // install backdoor and navigate back home
        if (success) {
          ns.print(`Backdooring: ${s}`);
          await ns.asleep(100);
          await getNsData(ns, "await ns.installBackdoor()", "/temp/backdoor");
          ns.print(`Returning home`);
          await getNsData(ns, "ns.connect('home')", "/temp/connect");
        }
      }
    }

    await ns.asleep(5000);
  }
}
