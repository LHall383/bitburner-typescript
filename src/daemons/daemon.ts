import { BitNodeMultipliers, NS } from "@ns";
import { customGetStats, getNsData } from "/modules/helper";
import { Stats, TimedCall } from "/types";

interface Flags {
  finishedDeploy: boolean;
  purchasedServers: boolean;
  launchedUpgrades: boolean;
  upgradedServers: boolean;
  bbDaemonPID: number;
  corpDaemonPID: number;
  gangDaemonPID: number;
  hackDaemonPID: number;
  schedulerPID: number;
  dispatcherPID: number;
  timedCalls: TimedCall[];
}

const schedulerPort = 2;
const dispatcherPort = 3;

export async function main(ns: NS): Promise<void> {
  // parse command line args
  const args = ns.flags([["loop", true]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting main daemon----------");

  // constants used as signals
  let stats = await customGetStats(ns);
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
    bbDaemonPID: 0,
    corpDaemonPID: 0,
    gangDaemonPID: 0,
    hackDaemonPID: 0,
    schedulerPID: 0,
    dispatcherPID: 0,
    timedCalls: timedCalls,
  } as Flags;

  // bitnode multipliers, these shouldn't change
  const bnMult = (await getNsData(
    ns,
    "ns.getBitNodeMultipliers()",
    "/temp/bn-multipliers"
  )) as BitNodeMultipliers;

  // continuously deploy hack script as we acquire new port cracking programs
  ns.run("scripts/continuous-deploy.js", 1, "--target", "n00dles");
  ns.print("Launched continuous-deploy");
  await ns.asleep(1000);

  // nuke all possible servers (TODO: if no singularity, don't backdoor)
  const backdoorList = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
    "fulcrumassets",
  ];
  const nukeServersArgs = [] as string[];
  backdoorList.forEach((s) => {
    nukeServersArgs.push("--backdoor");
    nukeServersArgs.push(s);
  });
  ns.run("scripts/nuke-servers.js", 1, ...nukeServersArgs);
  ns.print("Launched nuke-servers");
  await ns.asleep(1000);

  // purchase private servers when we have the money
  ns.run("scripts/purchase-servers.js", 1, "--target", "n00dles");
  ns.print("Launched purchase-servers");
  await ns.asleep(1000);

  // put up the stats UI
  ns.run("interface/overview-stats.js", 1, "--port", 20);
  ns.print("Launched overview-stats");
  await ns.asleep(1000);

  // TODO: check for singularity for the following scripts
  // purchase TOR router and darkweb port cracking programs
  ns.run("scripts/purchase-dw.js", 1);
  ns.print("Launched purchase-dw");
  await ns.asleep(1000);
  // automatically join factions available to us
  ns.run("scripts/join-factions.js", 1);
  ns.print("Launched join-factions");
  await ns.asleep(1000);

  // variables used in main loop
  const p1Handle = ns.getPortHandle(1);
  const hackTargets = [
    "nectar-net",
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
  stats = await customGetStats(ns, ["home", ...hackTargets]);

  // sort hackTargets
  hackTargets.sort(
    (a, b) =>
      stats.servers[a].requiredHackingSkill -
      stats.servers[b].requiredHackingSkill
  );

  // main loop
  do {
    // update stats
    stats = await customGetStats(ns, ["home", ...hackTargets]);

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

    // if we are in bb, launch the bb-daemon to manage it
    if (stats.player.inBladeburner && !flags.bbDaemonPID) {
      flags.bbDaemonPID = ns.run("daemons/bladeburner-daemon.js", 1);
      ns.print(`Launching bladeburner-daemon with PID: ${flags.bbDaemonPID}`);
      await ns.asleep(1000);
    }

    // if we are in a gang, launch gang-daemon
    const inGang = (await getNsData(
      ns,
      "ns.gang.inGang()",
      "/temp/gang-in-gang"
    )) as boolean;
    if (inGang && !flags.gangDaemonPID) {
      flags.gangDaemonPID = ns.run("daemons/gang-daemon.js", 1);
      ns.print(`Launching gang-daemon with PID: ${flags.gangDaemonPID}`);
      await ns.asleep(1000);
    }

    // launch upgrades when servers are fully purchased
    if (flags.purchasedServers && !flags.launchedUpgrades) {
      flags.launchedUpgrades = true;
      // scale max ram with hacking level/exp multipliers
      const power =
        (10 / (stats.player.hacking_exp_mult * bnMult.HackExpGain) +
          10 / (stats.player.hacking_mult * bnMult.HackingLevelMultiplier)) /
        2;
      const divisor = Math.pow(2, Math.round(Math.max(Math.min(power, 15), 0)));
      const maxRam = ns.getPurchasedServerMaxRam() / divisor;
      ns.print(`Power: ${power}`);
      ns.print(`Divisor: ${divisor}`);
      ns.print(`Ram: ${maxRam}`);
      ns.run(
        "scripts/upgrade-servers.js",
        1,
        "--target",
        "n00dles",
        "--maxRam",
        maxRam
      );
      ns.print("Launched upgrade-servers");
      await ns.asleep(1000);
    }

    // launch scheduler & dispatcher once all scripts are deployed
    if (
      flags.upgradedServers &&
      (flags.schedulerPID === 0 || flags.dispatcherPID === 0)
    ) {
      // launch scheduler
      if (flags.schedulerPID === 0) {
        const schedulerArgs = ["--port", schedulerPort];
        ns.getPurchasedServers().forEach((s) => {
          schedulerArgs.push("--ramPool");
          schedulerArgs.push(s);
        });
        flags.schedulerPID = ns.run(
          "/services/scheduler.js",
          1,
          ...schedulerArgs
        );
        ns.print(
          `Launched scheduler with PID: ${flags.schedulerPID} and args: ${schedulerArgs}`
        );
        if (flags.schedulerPID !== 0)
          ns.toast(`Launched scheduler with PID: ${flags.schedulerPID}`);
        await ns.asleep(1000);
      }

      // launch dispatcher
      if (flags.dispatcherPID === 0) {
        const dispatcherArgs = ["--port", dispatcherPort];
        flags.dispatcherPID = ns.run(
          "/services/dispatcher.js",
          1,
          ...dispatcherArgs
        );
        ns.print(
          `Launched dispatcher with PID: ${flags.dispatcherPID} and args: ${dispatcherArgs}`
        );
        if (flags.dispatcherPID !== 0)
          ns.toast(`Launched dispatcher with PID: ${flags.dispatcherPID}`);
        await ns.asleep(1000);
      }
    }

    // use pservs for hack daemon rather than basic hack
    if (
      flags.purchasedServers &&
      flags.upgradedServers &&
      flags.schedulerPID !== 0 &&
      flags.dispatcherPID !== 0 &&
      flags.hackDaemonPID === 0 &&
      stats.servers["home"].maxRam - stats.servers["home"].ramUsed >
        ns.getScriptRam("daemons/hack-daemon.js", "home")
    ) {
      flags.hackDaemonPID = ns.run(
        "daemons/hack-daemon.js",
        1,
        "--loop",
        "--schedulerPort",
        schedulerPort,
        "--dispatcherPort",
        dispatcherPort
      );
      ns.print(`Launching hack-daemon with PID: ${flags.hackDaemonPID}`);
      if (flags.hackDaemonPID !== 0)
        ns.toast(`Launched hack-daemon with PID: ${flags.hackDaemonPID}`);
      await ns.asleep(1000);
    }

    // if we have a corporation, launch the corp-daemon to manage it
    if (stats.player.hasCorporation && !flags.corpDaemonPID) {
      flags.corpDaemonPID = ns.run("daemons/corp-daemon.js", 1, "--loop");
      ns.print(`Launching corp-daemon with PID: ${flags.corpDaemonPID}`);
      await ns.asleep(1000);
    }

    // manage hashes each loop
    await manageHashes(ns);

    // TODO: share pserv-0 if we aren't using it
    // scp scripts/basic/share.js pserv-0; connect pserv-0; killall; run scripts/basic/share.js -t 256 --loop; home

    await ns.asleep(1000);
  } while (args["loop"]);
}

async function launchCodingContracts(ns: NS, stats: Stats): Promise<void> {
  if (
    stats.servers["home"].maxRam - stats.servers["home"].ramUsed >
    ns.getScriptRam("/scripts/solve-coding-contracts.js")
  ) {
    const pid = ns.run("/scripts/solve-coding-contracts.js", 1);
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

async function manageHashes(ns: NS): Promise<void> {
  // get hash stats
  const hashCap = ns.hacknet.hashCapacity();
  let hashes = ns.hacknet.numHashes();

  // if we are over threshold sell hashes
  while (hashes > hashCap * 0.95) {
    ns.hacknet.spendHashes("Sell for Money");
    hashes = ns.hacknet.numHashes();
    await ns.asleep(1);
  }
}
