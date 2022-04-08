import { NS, Player, Server } from "@ns";
import { getStats, msToTime } from "/modules/helper.js";
import {
  createMessage,
  getSchedulerMaxRam,
  packMessage,
  sendReceive,
} from "/modules/messaging";
import {
  Job,
  ScheduledJob,
  SchedulerRequest,
  SchedulerResponse,
  ScriptInfo,
  ScriptsInfo,
  Stats,
  TimedCall,
} from "/types.js";

interface Batch {
  jobs: Job[];
  batchStart: number;
  batchEnd: number;
}

interface ScheduledBatch {
  jobs: ScheduledJob[];
  batchStart: number;
  batchEnd: number;
}

const weakenSecurityEffect = 0.05;
const scheduleBufferTime = 1000;
const executeBufferTime = 250;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["target", "joesguns"],
    ["loop", false],
    ["schedulerPort", 2],
    ["dispatcherPort", 3],
  ]);

  const maxBatchCount = 25;

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting hack-daemon----------");

  // define basic hack/grow/weaken scripts
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

  // calc the most profitable server to hack
  const maxRamChunk = await getSchedulerMaxRam(ns, args["schedulerPort"]);
  const serverList = JSON.parse(ns.read("/data/flattened-list.txt")).split(
    ","
  ) as string[];
  let { hostname: bestTarget, profit } = await calcBestServer(
    ns,
    maxRamChunk,
    serverList,
    scripts
  );
  ns.print(
    `Best hack target is '${bestTarget}' at $${ns.nFormat(profit, "0.0a")}/sec`
  );

  // set up a timed job to recheck most profitable server
  const timedCalls = [
    {
      lastCalled: Date.now(),
      callEvery: 10 * 60 * 1000,
      callback: async () => {
        const maxRamChunk = await getSchedulerMaxRam(ns, args["schedulerPort"]);
        const response = await calcBestServer(
          ns,
          maxRamChunk,
          serverList,
          scripts
        );
        bestTarget = response.hostname;
        profit = response.profit;
        ns.print(
          `Best hack target is '${bestTarget}' at $${ns.nFormat(
            profit,
            "0.0a"
          )}/sec`
        );
      },
    },
  ] as TimedCall[];

  // grow to max money and reduce to min security
  await prepareServer(
    ns,
    bestTarget,
    scripts,
    args["schedulerPort"],
    args["dispatcherPort"],
    maxBatchCount
  );

  // HWGW cycle
  let stats = getStats(ns, [bestTarget]);
  do {
    // update stats
    stats = getStats(ns, [bestTarget]);

    // if it's time, service these functions
    const now = Date.now();
    for (const timedCall of timedCalls) {
      if (now - timedCall.lastCalled > timedCall.callEvery) {
        await timedCall.callback();
        timedCall.lastCalled = now;
      }
    }

    // if security is not at minimum or money is not at max, notify and fix
    stats = getStats(ns, [bestTarget]);
    if (
      stats.servers[bestTarget].moneyAvailable <
        stats.servers[bestTarget].moneyMax ||
      stats.servers[bestTarget].hackDifficulty >
        stats.servers[bestTarget].minDifficulty
    ) {
      ns.print(
        "-----TARGET NOT AT MAX MONEY/MIN SECURITY AFTER HWGW CYCLE-----"
      );
      ns.toast(
        `Hack-daemon targeting ${bestTarget} not at max money/min security after HWGW cycle.`,
        "warning"
      );
      await prepareServer(
        ns,
        bestTarget,
        scripts,
        args["schedulerPort"],
        args["dispatcherPort"],
        maxBatchCount
      );
    }

    // run up to maxBatchCount batches of HWGW
    stats = getStats(ns, [bestTarget]);
    printServerStats(ns, stats.servers[bestTarget]);
    await runHWGWBatch(
      ns,
      stats,
      bestTarget,
      scripts,
      args["schedulerPort"],
      args["dispatcherPort"],
      maxBatchCount
    );
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
    if (verbose) ns.print(`Sleeping ${sleepTime} until ${msToTime(timeMS)}`);
    useAsleep ? await ns.asleep(sleepTime) : await ns.sleep(sleepTime);
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

async function prepareServer(
  ns: NS,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort: number,
  dispatcherPort: number,
  maxBatchCount: number
) {
  let stats = getStats(ns, [target]);
  ns.print(`Reducing ${target} to minimum security`);

  // weaken to minimum security
  while (
    stats.servers[target].hackDifficulty > stats.servers[target].minDifficulty
  ) {
    printServerStats(ns, stats.servers[target]);
    await runWeakenBatch(
      ns,
      stats,
      target,
      scripts,
      schedulerPort,
      dispatcherPort,
      maxBatchCount
    );
    stats = getStats(ns, [target]);
  }

  // grow to maximum money
  while (
    stats.servers[target].moneyAvailable < stats.servers[target].moneyMax
  ) {
    printServerStats(ns, stats.servers[target]);
    await runGrowWeakenBatch(
      ns,
      stats,
      target,
      scripts,
      schedulerPort,
      dispatcherPort,
      maxBatchCount
    );
    stats = getStats(ns, [target]);
  }
}

async function runWeakenBatch(
  ns: NS,
  stats: Stats,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort: number,
  dispatcherPort: number,
  maxBatchCount: number
) {
  // calculate max weaken threads
  const maxRamChunk = await getSchedulerMaxRam(ns, schedulerPort);
  const wThreads = Math.floor(maxRamChunk / scripts.weakenScript.ram);
  const wTime = ns.formulas.hacking.weakenTime(
    stats.servers[target],
    stats.player
  );

  // create jobs
  const wStart = Date.now() + scheduleBufferTime;
  const wEnd = wStart + wTime + scheduleBufferTime + executeBufferTime;
  const weakenJob = {
    name: `W - ${msToTime(wEnd)}`,
    scriptName: scripts.weakenScript.name,
    startTime: wStart,
    endTime: wEnd,
    threads: wThreads,
    ram: wThreads * scripts.weakenScript.ram,
    args: ["--target", target, "--id", `W - ${msToTime(wEnd)}`],
  } as Job;

  // create batch
  const seedBatch = {
    jobs: [weakenJob],
    batchStart: wStart,
    batchEnd: wEnd,
  } as Batch;

  // extend up to maxBatchCount
  const batches = extendBatch(ns, seedBatch, maxBatchCount);

  // schedule batches until scheduler is full or we are out of batches
  const scheduledBatches = await scheduleBatches(ns, batches, schedulerPort);
  const lastBatchTime =
    scheduledBatches.length > 0
      ? scheduledBatches[scheduledBatches.length - 1].batchEnd +
        scheduleBufferTime
      : Date.now() + scheduleBufferTime;
  ns.print(`Successfully scheduled ${scheduledBatches.length} W batches`);

  // message all jobs to the dispatcher
  const dPortHandle = ns.getPortHandle(dispatcherPort);
  for (const sb of scheduledBatches) {
    const sj = sb.jobs;
    for (const job of sj) {
      const packedDispatcherMessage = packMessage(
        ns,
        `Dispatch job ${job.name}`,
        job
      );

      while (!dPortHandle.tryWrite(packedDispatcherMessage)) await ns.sleep(1);
    }
  }

  await sleepUntil(ns, lastBatchTime, false, true);
}

async function runGrowWeakenBatch(
  ns: NS,
  stats: Stats,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort: number,
  dispatcherPort: number,
  maxBatchCount: number
) {
  // calc max grow threads
  const maxRamChunk = await getSchedulerMaxRam(ns, schedulerPort);
  const gThreads = Math.floor(maxRamChunk / scripts.growScript.ram);
  const wThreads = Math.ceil(
    ns.growthAnalyzeSecurity(gThreads) / weakenSecurityEffect
  );

  // calc timings, NOTE: we assume here grow is always shorter than weaken
  const wTime = ns.formulas.hacking.weakenTime(
    stats.servers[target],
    stats.player
  );
  const gTime = ns.formulas.hacking.growTime(
    stats.servers[target],
    stats.player
  );
  const wStart = Date.now() + scheduleBufferTime;
  const wEnd = wStart + wTime + scheduleBufferTime + executeBufferTime;
  const gEnd = wEnd - executeBufferTime;
  const gStart = gEnd - gTime;

  // create jobs
  const weakenJob = {
    name: `W - ${msToTime(wEnd)}`,
    scriptName: scripts.weakenScript.name,
    startTime: wStart,
    endTime: wEnd,
    threads: wThreads,
    ram: wThreads * scripts.weakenScript.ram,
    args: ["--target", target, "--id", `W - ${msToTime(wEnd)}`],
  } as Job;
  const growJob = {
    name: `G - ${msToTime(gEnd)}`,
    scriptName: scripts.growScript.name,
    startTime: gStart,
    endTime: gEnd,
    threads: gThreads,
    ram: gThreads * scripts.growScript.ram,
    args: ["--target", target, "--id", `G - ${msToTime(gEnd)}`],
  } as Job;

  // create batch
  const seedBatch = {
    jobs: [growJob, weakenJob],
    batchStart: wStart,
    batchEnd: wEnd,
  } as Batch;

  // extend up to maxBatchCount
  const batches = extendBatch(ns, seedBatch, maxBatchCount);

  // schedule batches until scheduler is full or we are out of batches
  const scheduledBatches = await scheduleBatches(ns, batches, schedulerPort);
  const lastBatchTime =
    scheduledBatches.length > 0
      ? scheduledBatches[scheduledBatches.length - 1].batchEnd +
        scheduleBufferTime
      : Date.now() + scheduleBufferTime;
  ns.print(`Successfully scheduled ${scheduledBatches.length} GW batches`);

  // message all jobs to the dispatcher
  const dPortHandle = ns.getPortHandle(dispatcherPort);
  for (const sb of scheduledBatches) {
    const sj = sb.jobs;
    for (const job of sj) {
      const packedDispatcherMessage = packMessage(
        ns,
        `Dispatch job ${job.name}`,
        job
      );

      while (!dPortHandle.tryWrite(packedDispatcherMessage)) await ns.sleep(1);
    }
  }

  await sleepUntil(ns, lastBatchTime, false, true);
}

async function runHWGWBatch(
  ns: NS,
  stats: Stats,
  target: string,
  scripts: ScriptsInfo,
  schedulerPort: number,
  dispatcherPort: number,
  maxBatchCount: number
) {
  // calc HWGW threads
  const maxRamChunk = await getSchedulerMaxRam(ns, schedulerPort);
  const { hThreads, gThreads } = calcHackGrowThreads(
    ns,
    stats.servers[target],
    stats.player,
    maxRamChunk,
    scripts
  );
  const hOffsetThreads =
    Math.ceil(ns.hackAnalyzeSecurity(hThreads) / weakenSecurityEffect) + 1;
  const gOffsetThreads =
    Math.ceil(ns.growthAnalyzeSecurity(gThreads) / weakenSecurityEffect) + 1;

  // calc timings, NOTE: we assume here that weaken is always longest
  const wTime = ns.formulas.hacking.weakenTime(
    stats.servers[target],
    stats.player
  );
  const gTime = ns.formulas.hacking.growTime(
    stats.servers[target],
    stats.player
  );
  const hTime = ns.formulas.hacking.hackTime(
    stats.servers[target],
    stats.player
  );
  const now = Date.now();
  const w2End = now + wTime + scheduleBufferTime + executeBufferTime * 4;
  const gEnd = w2End - executeBufferTime;
  const w1End = w2End - executeBufferTime * 2;
  const hEnd = w2End - executeBufferTime * 3;
  const hStart = hEnd - hTime;
  const w1Start = w1End - wTime;
  const gStart = gEnd - gTime;
  const w2Start = w2End - wTime;

  // create jobs
  const hackJob = {
    name: `H - ${msToTime(hEnd)}`,
    scriptName: scripts.hackScript.name,
    startTime: hStart,
    endTime: hEnd,
    threads: hThreads,
    ram: hThreads * scripts.hackScript.ram,
    args: ["--target", target, "--id", `H - ${msToTime(hEnd)}`],
  } as Job;
  const weakenJob1 = {
    name: `W1 - ${msToTime(w1End)}`,
    scriptName: scripts.weakenScript.name,
    startTime: w1Start,
    endTime: w1End,
    threads: hOffsetThreads,
    ram: hOffsetThreads * scripts.weakenScript.ram,
    args: ["--target", target, "--id", `W1 - ${msToTime(w1End)}`],
  } as Job;
  const growJob = {
    name: `G - ${msToTime(gEnd)}`,
    scriptName: scripts.growScript.name,
    startTime: gStart,
    endTime: gEnd,
    threads: gThreads,
    ram: gThreads * scripts.growScript.ram,
    args: ["--target", target, "--id", `G - ${msToTime(gEnd)}`],
  } as Job;
  const weakenJob2 = {
    name: `W2 - ${msToTime(w2End)}`,
    scriptName: scripts.weakenScript.name,
    startTime: w2Start,
    endTime: w2End,
    threads: gOffsetThreads,
    ram: gOffsetThreads * scripts.weakenScript.ram,
    args: ["--target", target, "--id", `W2 - ${msToTime(w2End)}`],
  } as Job;

  // create batch
  const seedBatch = {
    jobs: [growJob, hackJob, weakenJob1, weakenJob2],
    batchStart: w1Start,
    batchEnd: w2End,
  } as Batch;

  // extend up to maxBatchCount
  const batches = extendBatch(ns, seedBatch, maxBatchCount);

  // schedule batches until scheduler is full or we are out of batches
  const scheduledBatches = await scheduleBatches(ns, batches, schedulerPort);
  const lastBatchTime =
    scheduledBatches.length > 0
      ? scheduledBatches[scheduledBatches.length - 1].batchEnd +
        scheduleBufferTime
      : Date.now() + scheduleBufferTime;
  ns.print(`Successfully scheduled ${scheduledBatches.length} HWGW batches`);

  // message all jobs to the dispatcher
  const dPortHandle = ns.getPortHandle(dispatcherPort);
  for (const sb of scheduledBatches) {
    const sj = sb.jobs;
    for (const job of sj) {
      const packedDispatcherMessage = packMessage(
        ns,
        `Dispatch job ${job.name}`,
        job
      );

      while (!dPortHandle.tryWrite(packedDispatcherMessage)) await ns.sleep(1);
    }
  }

  await sleepUntil(ns, lastBatchTime, false, true);
}

async function scheduleBatches(
  ns: NS,
  batches: Batch[],
  schedulerPort: number
) {
  const scheduledBatches = [] as ScheduledBatch[];

  for (const batch of batches) {
    // schedule all jobs
    const scheduledJobs = [] as ScheduledJob[];
    for (const job of batch.jobs) {
      const schedulerResponse = await sendReceiveScheduleRequest(
        ns,
        job.ram,
        schedulerPort,
        job.startTime,
        job.endTime
      );
      if (schedulerResponse.success && schedulerResponse.host) {
        scheduledJobs.push({ ...job, host: schedulerResponse.host });
      } else {
        break;
      }
    }

    // if we weren't able to schedule all the jobs, leave loop early
    if (scheduledJobs.length < batch.jobs.length) {
      break;
    }

    // put all scheduled jobs back into batch and append
    const scheduledBatch = { ...batch, jobs: scheduledJobs } as ScheduledBatch;
    scheduledBatches.push(scheduledBatch);
  }

  return scheduledBatches;
}

function extendBatch(ns: NS, seedBatch: Batch, amount: number): Batch[] {
  const batches = [] as Batch[];
  batches.push(seedBatch);

  while (batches.length < amount) {
    const prevBatch = batches[batches.length - 1];
    const batch = {
      jobs: [],
      batchStart: prevBatch.batchStart + scheduleBufferTime,
      batchEnd: prevBatch.batchEnd + scheduleBufferTime,
    } as Batch;

    for (const job of prevBatch.jobs) {
      const startTime = job.startTime + scheduleBufferTime;
      const endTime = job.endTime + scheduleBufferTime;
      const name = [job.name.slice(0, -14), msToTime(endTime)].join("");
      const args = _.cloneDeep(job.args);
      args[args.length - 1] = name;
      batch.jobs.push({ ...job, startTime, endTime, name, args } as Job);
    }

    batches.push(batch);
  }

  return batches;
}

function calcBestServer(
  ns: NS,
  maxRamChunk: number,
  serverList: string[],
  scripts: ScriptsInfo
) {
  // get stats for player and servers
  const stats = getStats(ns, serverList);

  const cashPerSec = [] as { hostname: string; profit: number }[];
  for (const hostname of serverList) {
    const player = stats.player;
    const server = stats.servers[hostname];

    // we want to calculate profits at min security and max money
    server.hackDifficulty = server.minDifficulty;
    server.moneyAvailable = server.moneyMax;

    if (
      !server.purchasedByPlayer &&
      hostname !== "home" &&
      server.requiredHackingSkill < player.hacking
    ) {
      // check how many threads we would need to hack and grow
      const threads = calcHackGrowThreads(
        ns,
        server,
        player,
        maxRamChunk,
        scripts
      );

      // check how much money we could make from hacking this server
      const profit = calcServerProfitability(
        ns,
        hostname,
        server,
        player,
        maxRamChunk,
        threads.hThreads
      );
      // ns.print(`${ns.nFormat(profit, "$0.0a")}/sec for server '${hostname}'`);
      cashPerSec.push({ hostname, profit });
    }
  }

  const result = _.maxBy(cashPerSec, (x) => x.profit) as {
    hostname: string;
    profit: number;
  };
  return result;
}

function calcServerProfitability(
  ns: NS,
  target: string,
  targetStats: Server,
  playerStats: Player,
  maxRamChunk: number,
  hackThreads: number
): number {
  // calc hack amount
  const hackPercent =
    ns.formulas.hacking.hackPercent(targetStats, playerStats) * hackThreads;
  const hackAmount = hackPercent * targetStats.moneyMax;

  // calc weaken time
  const wTime = ns.formulas.hacking.weakenTime(targetStats, playerStats);

  return hackAmount / (wTime / 1000);
}

function calcHackGrowThreads(
  ns: NS,
  targetStats: Server,
  playerStats: Player,
  maxRamChunk: number,
  scripts: ScriptsInfo
) {
  // calc grow & hack effect for max ram
  const gThreadsMax = Math.floor(maxRamChunk / scripts.growScript.ram);
  const hThreadsMax = Math.floor(maxRamChunk / scripts.hackScript.ram);
  const gPercentMax = ns.formulas.hacking.growPercent(
    targetStats,
    gThreadsMax,
    playerStats,
    1
  );
  const hPercentMax =
    ns.formulas.hacking.hackPercent(targetStats, playerStats) * hThreadsMax;

  // calculate actual hack/grow threads based on which one will run at max threads
  let hThreads;
  let gThreads;
  if (1 - 1 / gPercentMax > hPercentMax) {
    // hack is the limiting factor, turn down grow to just over hack
    let gPercent = gPercentMax;
    hThreads = hThreadsMax;
    gThreads = gThreadsMax;
    while (1 - 1 / gPercent > hPercentMax) {
      gThreads--;
      gPercent = ns.formulas.hacking.growPercent(
        targetStats,
        gThreads,
        playerStats,
        1
      );
    }
    gThreads++;
    gPercent = ns.formulas.hacking.growPercent(
      targetStats,
      gThreads,
      playerStats,
      1
    );
  } else {
    // grow is the limiting factor, turn down hack to just below grow
    let hPercent = hPercentMax;
    hThreads = hThreadsMax;
    gThreads = gThreadsMax;
    while (1 - 1 / gPercentMax < hPercent) {
      hThreads--;
      hPercent =
        ns.formulas.hacking.hackPercent(targetStats, playerStats) * hThreads;
      if (hThreads <= 1) break; // dont hack with less than 1 thread
    }
  }

  return { hThreads, gThreads };
}
