import { NS } from "@ns";
import { getStats } from "/modules/helper";
import { Flags, Stats, TimedCall } from "/types";

export async function main(ns: NS): Promise<void> {
  // parse command line args
  const args = ns.flags([["loop", true]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting main daemon----------");

  // constants used as signals
  let stats = getStats(ns);
  const timedCalls = [
    {
      lastCalled: Date.now(),
      callEvery: 10 * 60 * 1000,
      callback: async () => await launchCodingContracts(ns, stats),
    },
  ] as TimedCall[];
  const flags = {
    finishedDeploy: false,
    purchasedServers: false,
    launchedUpgrades: false,
    upgradedServers: false,
    launchedCorpDaemon: false,
    schedulerPID: 0,
    timedCalls: timedCalls,
  } as Flags;

  // continuously deploy hack script as we acquire new port cracking programs
  ns.exec("scripts/continuous-deploy.js", "home", 1, "--target", "n00dles");
  ns.print("Launched continuous-deploy");
  await ns.sleep(1000);

  // purchase private servers when we have the money
  ns.exec("scripts/purchase-servers.js", "home", 1, "--target", "n00dles");
  ns.print("Launched purchase-servers");
  await ns.sleep(1000);

  // put up the stats UI
  ns.exec("scripts/overview-stats.js", "home", 1);
  ns.print("Launched overview-stats");
  await ns.sleep(1000);

  // variables used in main loop
  const p1Handle = ns.getPortHandle(1);
  const hackTargets = [
    "foodnstuff",
    "sigma-cosmetics",
    "joesguns",
    "hong-fang-tea",
    "harakiri-sushi",
    "iron-gym",
    "neo-net",
    "syscore",
    "zer0",
    "max-hardware",
    "phantasy",
    "omega-net",
  ];
  const claimedServers = [];
  stats = getStats(ns, ["home", ...hackTargets]);

  // sort hackTargets
  hackTargets.sort(
    (a, b) =>
      stats.servers[a].requiredHackingSkill -
      stats.servers[b].requiredHackingSkill
  );

  // main loop
  do {
    // update stats
    stats = getStats(ns, ["home", ...hackTargets]);

    // read port 1 for global updates
    if (p1Handle.peek() !== "NULL PORT DATA") {
      handleP1Message(ns, p1Handle.read(), flags);
    }

    // if it's time, service these functions
    const now = Date.now();
    for (const timedCall of flags.timedCalls) {
      if (now - timedCall.lastCalled > timedCall.callEvery) {
        await timedCall.callback();
        timedCall.lastCalled = now;
      }
    }

    // launch upgrades when servers are fully purchased
    if (flags.purchasedServers && !flags.launchedUpgrades) {
      flags.launchedUpgrades = true;
      const maxRam = 1024; // ns.getPurchasedServerMaxRam() / Math.pow(2, 10)
      ns.exec(
        "scripts/upgrade-servers.js",
        "home",
        1,
        "--target",
        "n00dles",
        "--maxRam",
        maxRam
      );
      ns.print("Launched upgrade-servers");
      await ns.sleep(1000);
    }

    // launch scheduler once all scripts are deployed
    if (flags.finishedDeploy && flags.schedulerPID === 0) {
      flags.schedulerPID = ns.exec("/services/scheduler.js", "home", 1);
    }

    // use pservs for hack daemon rather than basic hack
    if (
      flags.purchasedServers &&
      flags.upgradedServers &&
      hackTargets.length > 0 &&
      stats.servers["home"].maxRam - stats.servers["home"].ramUsed >
        ns.getScriptRam("daemons/hack-daemon.js", "home")
    ) {
      const t = stats.servers[hackTargets[0]];

      if (stats.player.hacking > t.requiredHackingSkill) {
        const host1 = `pserv-${claimedServers.length + 1}` as string;
        const host2 = `pserv-${claimedServers.length + 2}` as string;
        ns.killall(host1);
        ns.killall(host2);
        claimedServers.push(host1);
        claimedServers.push(host2);

        ns.exec(
          "daemons/hack-daemon.js",
          "home",
          1,
          "--target",
          t.hostname,
          "--loop",
          "--ramBudget",
          1.0,
          "--hosts",
          host1,
          "--hosts",
          host2
        );
        ns.print(
          `Launching hack-daemon targeting ${t.hostname}, hosted on ${host1} and ${host2}`
        );
        hackTargets.shift();
      }
    }

    // if we have a corporation, launch the corp-daemon to manage it
    if (stats.player.hasCorporation && !flags.launchedCorpDaemon) {
      ns.exec("daemons/corp-daemon.js", "home", 1, "--loop");
      flags.launchedCorpDaemon = true;
      ns.print("Launching corp-daemon");
    }

    // TODO: share pserv-0 if we aren't using it
    // scp scripts/basic/share.js pserv-0; connect pserv-0; killall; run scripts/basic/share.js -t 256 --loop; home

    await ns.sleep(100);
  } while (args["loop"]);
}

async function launchCodingContracts(ns: NS, stats: Stats): Promise<void> {
  if (
    stats.servers["home"].maxRam - stats.servers["home"].ramUsed >
    ns.getScriptRam("/scripts/solve-coding-contracts.js")
  ) {
    const pid = ns.exec("/scripts/solve-coding-contracts.js", "home", 1);
    ns.print(`Launching coding contracts with PID: ${pid}`);
  } else {
    ns.print(`Not enough RAM to run solve-coding-contracts`);
  }
}

function handleP1Message(ns: NS, message: string | number, flags: Flags): void {
  // attempt to parse port message
  try {
    if (typeof message === "number") {
      ns.print(message);
      return;
    }
    const parsed = JSON.parse(message);
    if (typeof parsed !== "object") {
      ns.print(message);
      return;
    }

    // handle parsed message object
    ns.print(`${parsed.source}: ${parsed.message}`);
    switch (parsed.source) {
      case "continuous-deploy":
        if (parsed.exiting) {
          flags.finishedDeploy = true;
        }
        break;
      case "purchase-servers":
        if (parsed.exiting) {
          flags.purchasedServers = true;
        }
        break;
      case "upgrade-servers":
        if (parsed.exiting) {
          flags.upgradedServers = true;
        }
        break;
      default:
        break;
    }
  } catch (e) {
    ns.print(message);
  }
}
