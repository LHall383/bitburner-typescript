import { NS, Server } from "@ns";
import { getStats } from "/modules/helper.js";
import {
  createMessage,
  getSchedulerMaxRam,
  sendReceive,
} from "/modules/messaging";
import {
  Job,
  ScheduledJob,
  SchedulerRequest,
  SchedulerResponse,
  ScriptInfo,
  ScriptsInfo,
} from "/types.js";

const weakenSecurityEffect = 0.05;
const growSecurityEffect = 0.004;
const hackSecurityEffect = 0.002;
const scheduleBufferTime = 1000;
const executeBufferTime = 200;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["target", "joesguns"],
    ["ramBudget", 0.8],
    ["loop", false],
    ["hosts", ["pserv-0", "pserv-1"]],
    ["useScheduler", false],
    ["schedulerPort", 2],
  ]);

  let stats = getStats(ns, [args["target"], ...args["hosts"]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting hack-daemon----------");

  // copy scripts to hosts
  const hackScript = {
    name: "/scripts/basic/hack.js",
    ram: ns.getScriptRam("/scripts/basic/hack.js", "home"),
  } as ScriptInfo;
  const growScript = {
    name: "/scripts/basic/grow.js",
    ram: ns.getScriptRam("/scripts/basic/grow.js", "home"),
  } as ScriptInfo;
  const weakenScript = {
    name: "/scripts/basic/weaken.js",
    ram: ns.getScriptRam("/scripts/basic/weaken.js", "home"),
  } as ScriptInfo;
  const scripts = { hackScript, growScript, weakenScript } as ScriptsInfo;
  ns.print("Copying scripts to hosts");
  for (const host of args["hosts"]) {
    await ns.scp(
      [hackScript.name, growScript.name, weakenScript.name],
      "home",
      host
    );
  }

  // grow target to max money (while keeping security low)
  await growToMaxMoney(ns, args["target"], scripts, args["schedulerPort"]);

  // reduce target to minimum security level
  await reduceToMinSecurity(ns, args["target"], scripts, args["schedulerPort"]);

  // HWGW cycle
  do {
    // update stats
    stats = getStats(ns, [args["target"], ...args["hosts"]]);

    // if money is not at max, grow it here and notify
    if (
      stats.servers[args["target"]].moneyAvailable <
      stats.servers[args["target"]].moneyMax
    ) {
      ns.print("-----TARGET NOT AT MAX MONEY AFTER HWGW CYCLE-----");
      ns.toast(
        `Hack-daemon targeting ${args["target"]} not at max money after HWGW cycle.`,
        "warning"
      );
      await growToMaxMoney(ns, args["target"], scripts, args["schedulerPort"]);
    }

    // if security is not at minimum, drop it here and notify
    if (
      stats.servers[args["target"]].hackDifficulty >
      stats.servers[args["target"]].minDifficulty
    ) {
      ns.print("-----TARGET NOT AT MIN SECURITY AFTER HWGW CYCLE-----");
      ns.toast(
        `Hack-daemon targeting ${args["target"]} not at min security after HWGW cycle.`,
        "warning"
      );
      await reduceToMinSecurity(
        ns,
        args["target"],
        scripts,
        args["schedulerPort"]
      );
    }

    // get max ram chunk
    const maxRamChunk = await getSchedulerMaxRam(ns, args["schedulerPort"]);

    // calc grow effect for max ram
    const gThreads = Math.floor(maxRamChunk / growScript.ram);
    if (gThreads <= 0) {
      ns.print(`Grow threads calculated at ${gThreads}, skipping`);
      continue;
    }
    const gTime = ns.formulas.hacking.growTime(
      stats.servers[args["target"]],
      stats.player
    );
    const gPercent = ns.formulas.hacking.growPercent(
      stats.servers[args["target"]],
      gThreads,
      stats.player,
      1
    );

    // find threads to hack equal to grow
    const hPercent = 1 - 1 / gPercent;
    const hThreads = Math.floor(
      ns.hackAnalyzeThreads(
        stats.servers[args["target"]].hostname,
        stats.servers[args["target"]].moneyMax * hPercent
      )
    );
    const hTime = ns.formulas.hacking.hackTime(
      stats.servers[args["target"]] as Server,
      stats.player
    );
    if (hThreads <= 0) {
      ns.print(`Hack threads calculated at ${gThreads}, skipping`);
      continue;
    }

    // find threads of weaken to offset hack and grow
    const hOffsetThreads = Math.ceil(
      (hackSecurityEffect * hThreads) / weakenSecurityEffect
    );
    const gOffsetThreads = Math.ceil(
      (growSecurityEffect * gThreads) / weakenSecurityEffect
    );
    const wTime = ns.formulas.hacking.weakenTime(
      stats.servers[args["target"]] as Server,
      stats.player
    );

    // calc run times
    const now = Date.now();
    const endHackTime =
      now + Math.max(hTime, wTime, gTime) + scheduleBufferTime;
    const startHackTime = endHackTime - hTime;
    const startWeaken1Time = endHackTime - wTime + executeBufferTime;
    const startGrowTime = endHackTime - gTime + executeBufferTime * 2;
    const startWeaken2Time = endHackTime - wTime + executeBufferTime * 3;

    // aggregate jobs
    const hackJob = {
      scriptName: hackScript.name,
      startTime: startHackTime,
      endTime: endHackTime,
      threads: hThreads,
      ram: hThreads * hackScript.ram,
      args: [
        "--target",
        args["target"],
        "--id",
        `H - ${ns.nFormat(endHackTime, "0.0")}`,
      ],
    };
    const weaken1Job = {
      scriptName: weakenScript.name,
      startTime: startWeaken1Time,
      endTime: startWeaken1Time + wTime,
      threads: hOffsetThreads,
      ram: hOffsetThreads * weakenScript.ram,
      args: [
        "--target",
        args["target"],
        "--id",
        `W1 - ${ns.nFormat(startWeaken1Time + wTime, "0.0")}`,
      ],
    };
    const growJob = {
      scriptName: growScript.name,
      startTime: startGrowTime,
      endTime: startGrowTime + gTime,
      threads: gThreads,
      ram: gThreads * growScript.ram,
      args: [
        "--target",
        args["target"],
        "--id",
        `G - ${ns.nFormat(startGrowTime + gTime, "0.0")}`,
      ],
    };
    const weaken2Job = {
      scriptName: weakenScript.name,
      startTime: startWeaken2Time,
      endTime: startWeaken2Time + wTime,
      threads: gOffsetThreads,
      ram: gOffsetThreads * weakenScript.ram,
      args: [
        "--target",
        args["target"],
        "--id",
        `W2 - ${ns.nFormat(startWeaken2Time + wTime, "0.0")}`,
      ],
    };
    const jobs = [hackJob, weaken1Job, growJob, weaken2Job] as Job[];

    // output stats about jobs
    for (const job of jobs) {
      ns.print(
        `${job.args[3].split(" ")[0]} with ${job.threads} threads. ${new Date(
          job.startTime
        ).toISOString()} -> ${new Date(job.endTime).toISOString()}`
      );
    }

    // schedule jobs
    const scheduledJobs = [] as ScheduledJob[];
    for (const job of jobs) {
      const schedulerResponse = await sendReceiveScheduleRequest(
        ns,
        job.ram,
        args["schedulerPort"],
        job.startTime,
        job.endTime
      );
      if (schedulerResponse.success && schedulerResponse.host) {
        scheduledJobs.push({ ...job, host: schedulerResponse.host });
      } else {
        break;
      }
    }

    // if we weren't able to schedule all the jobs, leave loop
    if (scheduledJobs.length < jobs.length) {
      ns.print("COULD NOT SCHEDULE ALL JOBS, SKIPPING TO NEXT LOOP");
      await ns.sleep(scheduleBufferTime);
      continue;
    }

    // execute scheduled jobs
    scheduledJobs.sort((a, b) => a.startTime - b.startTime);
    const endBatchTime = scheduledJobs[scheduledJobs.length - 1].endTime;
    while (scheduledJobs.length > 0) {
      const job = scheduledJobs.shift() as ScheduledJob;
      ns.print(`Handling job: ${job.args[3].split(" ")[0]}`);

      // sleep until job start time
      await sleepUntil(ns, job.startTime);

      // execute job
      ns.enableLog("exec");
      const pid = ns.exec(job.scriptName, job.host, job.threads, ...job.args);
      ns.print(`Job: ${job.args[3].split(" ")[0]} executed with PID: ${pid}`);
      ns.disableLog("exec");
    }

    // sleep until batch is finished executing
    await sleepUntil(ns, endBatchTime + scheduleBufferTime);
  } while (args["loop"]);

  ns.print("----------End hack-daemon----------");
}

function printServerStats(ns: NS, stats: Server) {
  const mp = (stats.moneyAvailable / stats.moneyMax) * 100;
  const money = stats.moneyAvailable;
  const maxMoney = stats.moneyMax;

  const sp = (stats.hackDifficulty / stats.minDifficulty) * 100;
  const sec = stats.hackDifficulty;
  const minSec = stats.minDifficulty;

  ns.print(` Stats for ${stats.hostname}:`);
  ns.print(
    `   Money:    ${mp.toFixed(2)}% - ${money.toFixed(2)} / ${maxMoney}`
  );
  ns.print(`   Security: ${sp.toFixed(2)}% - ${sec.toFixed(2)} / ${minSec}`);
}

async function sleepUntil(
  ns: NS,
  timeMS: number,
  useAsleep = false,
  verbose = true
) {
  const sleepTime = Math.floor(timeMS - Date.now());
  if (sleepTime > 0) {
    if (verbose)
      ns.print(`Sleeping ${sleepTime} until ${new Date(timeMS).toISOString()}`);
    useAsleep ? await ns.asleep(sleepTime) : await ns.sleep(sleepTime);
  }
}

async function runWithScheduler(
  ns: NS,
  threads: number,
  script: ScriptInfo,
  executionTimeMS: number,
  schedulerPort: number,
  scriptArgs: string[]
): Promise<void> {
  const now = Date.now();
  const schedulerResponse = await sendReceiveScheduleRequest(
    ns,
    threads * script.ram,
    schedulerPort,
    now,
    now + executionTimeMS + scheduleBufferTime + executeBufferTime
  );

  if (schedulerResponse.success) {
    const pid = ns.exec(
      script.name,
      schedulerResponse.host as string,
      threads,
      ...scriptArgs
    );
    ns.print(
      `Executing ${script.name} on ${schedulerResponse.host} for ${ns.nFormat(
        schedulerResponse.endTime - schedulerResponse.startTime,
        "0.0"
      )}ms with PID: ${pid}`
    );
    await sleepUntil(ns, schedulerResponse.endTime);
  }
}

async function sendReceiveScheduleRequest(
  ns: NS,
  ram: number,
  schedulerPort: number,
  startTime: number,
  endTime: number
): Promise<SchedulerResponse> {
  const schedulerMessage = createMessage(
    ns.getScriptName() + JSON.stringify(ns.args),
    "Scheduler request",
    {
      ram,
      startTime,
      endTime,
    } as SchedulerRequest
  );
  const schedulerResponse = await sendReceive<
    SchedulerRequest,
    SchedulerResponse
  >(ns, schedulerPort, schedulerMessage);

  const response = schedulerResponse?.data.data;
  const defaultResponse = {
    ...schedulerMessage.data,
    success: false,
  } as SchedulerResponse;
  return response ?? defaultResponse;
}

async function growToMaxMoney(
  ns: NS,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort = 0
) {
  let stats = getStats(ns, [target]);
  ns.print(`Growing ${target} to maximum money`);

  while (
    stats.servers[target].moneyAvailable < stats.servers[target].moneyMax
  ) {
    printServerStats(ns, stats.servers[target]);

    const maxRamChunk = await getSchedulerMaxRam(ns, schedulerPort);
    const weakenThreshold = Math.max(
      stats.servers[target].minDifficulty * 1.5,
      stats.servers[target].minDifficulty + 10
    );

    // weaken if security is too strong, otherwise grow
    if (stats.servers[target].hackDifficulty > weakenThreshold) {
      const wThreads = Math.floor(maxRamChunk / scripts.weakenScript.ram);
      const wTime = ns.formulas.hacking.weakenTime(
        stats.servers[target],
        stats.player
      );
      await runWithScheduler(
        ns,
        wThreads,
        scripts.weakenScript,
        wTime,
        schedulerPort,
        ["--target", target, "--id", `W - ${ns.nFormat(Date.now(), "0.0")}`]
      );
    } else {
      const gThreads = Math.floor(maxRamChunk / scripts.growScript.ram);
      const gTime = ns.formulas.hacking.growTime(
        stats.servers[target],
        stats.player
      );
      await runWithScheduler(
        ns,
        gThreads,
        scripts.growScript,
        gTime,
        schedulerPort,
        ["--target", target, "--id", `G - ${ns.nFormat(Date.now(), "0.0")}`]
      );
    }

    await ns.sleep(executeBufferTime);
    stats = getStats(ns, [target]);
  } // end while

  ns.print("-----Target at maximum money-----");
  printServerStats(ns, stats.servers[target]);
}

async function reduceToMinSecurity(
  ns: NS,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort = 0
) {
  let stats = getStats(ns, [target]);
  ns.print(`Reducing ${target} to minimum security`);

  while (
    stats.servers[target].hackDifficulty > stats.servers[target].minDifficulty
  ) {
    printServerStats(ns, stats.servers[target]);

    const maxRamChunk = await getSchedulerMaxRam(ns, schedulerPort);

    const wThreads = Math.floor(maxRamChunk / scripts.weakenScript.ram);
    const wTime = ns.formulas.hacking.weakenTime(
      stats.servers[target],
      stats.player
    );
    await runWithScheduler(
      ns,
      wThreads,
      scripts.weakenScript,
      wTime,
      schedulerPort,
      ["--target", target, "--id", `W - ${ns.nFormat(Date.now(), "0.0")}`]
    );

    await ns.sleep(executeBufferTime);
    stats = getStats(ns, [target]);
  } // end while

  ns.print("-----Target at minimum security-----");
  printServerStats(ns, stats.servers[target]);
}
