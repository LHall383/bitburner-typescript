import { NS } from "@ns";
import { customGetStats } from "/modules/helper";
import { packMessage, sendHUDRequest, unpackMessage } from "/modules/messaging";
import {
  MessageResponse,
  SchedulerRequest,
  SchedulerResponse,
  Stats,
  TimedCall,
} from "/types";

const timeToExpiration = 250;
const executeBufferTime = 200;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["port", 2],
    [
      "ramPool",
      [
        "n00dles",
        "foodnstuff",
        "sigma-cosmetics",
        "joesguns",
        "nectar-net",
        "hong-fang-tea",
        "harakiri-sushi",
        "blade",
        "omnitek",
      ],
    ],
  ]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting scheduler----------");

  // clean up HUD at exit
  ns.atExit(() => {
    try {
      sendHUDRequest(ns, "Ram Pool", "", true);
    } catch {
      console.log("RIP");
    }
  });

  // maintain a copy of the ram pool array, so we can make edits
  const ramPool = _.cloneDeep(args["ramPool"]) as string[];

  // for each server in the ram pool, kill all scripts
  let stats = customGetStats(ns, ramPool);
  for (const server of ramPool) {
    if (ns.serverExists(server)) {
      ns.killall(server);
      ns.print(`Killed all scripts on ${server}`);
    }
  }

  // set up periodically serviced functions
  const timedCalls = [
    {
      lastCalled: Date.now(),
      callEvery: 1 * 1000,
      callback: async () => await printRamPoolStats(ns, stats, ramPool),
    },
  ] as TimedCall[];

  // start up the port and clear it
  const pHandle = ns.getPortHandle(args["port"]);
  pHandle.clear();
  ns.print(`Port ${args["port"]} opened and cleared`);

  // handle incoming service requests
  const scheduledJobs = {} as Record<string, SchedulerRequest[]>;
  ramPool.forEach((s) => (scheduledJobs[s] = []));
  ns.print("Ready for service requests!");
  while (true) {
    // update stats
    stats = customGetStats(ns, ramPool);
    const largestRamChunk = ramPool
      .map((s) => stats.servers[s].maxRam)
      .reduce((a, b) => (a > b ? a : b));

    // remove old jobs to free up memory
    for (const server of ramPool) {
      _.remove(
        scheduledJobs[server],
        (job) => Date.now() > job.endTime + executeBufferTime
      );
    }

    // if it's time, service these functions
    const now = Date.now();
    for (const timedCall of timedCalls) {
      if (now - timedCall.lastCalled > timedCall.callEvery) {
        await timedCall.callback();
        timedCall.lastCalled = now;
      }
    }

    // check for port data, discarding bad data and old messages
    const parsed = unpackMessage<number | SchedulerRequest>(ns, pHandle.peek());
    if (
      (!pHandle.empty() && parsed === undefined) || // message we are unable to parse
      (parsed && Date.now() - parsed.timeSent > timeToExpiration) // old message, not handled
    ) {
      pHandle.read();
      continue;
    }

    // if it's not from us, it's for us
    if (parsed && parsed.source !== ns.getScriptName()) {
      pHandle.read(); // consume message

      if (typeof parsed.data === "number") {
        // handle max ram request
        ns.print(`Received max ram request from ${parsed.source}`);
        const response = packMessage(
          ns,
          `Response to ram request from ${parsed.source}`,
          {
            sourceMessage: parsed,
            data: largestRamChunk,
          } as MessageResponse<number>
        );
        pHandle.write(response);
        ns.print(`Responded with max ram = ${largestRamChunk}`);
      } else {
        // handle scheduling request
        ns.print(`Received scheduling request from: ${parsed.source}`);

        const scheduled = scheduleRequest(
          ns,
          stats,
          ramPool,
          scheduledJobs,
          parsed.data
        );

        const response = packMessage(
          ns,
          `Response to scheduler request from ${parsed.source}`,
          {
            sourceMessage: parsed,
            data: scheduled,
          } as MessageResponse<SchedulerResponse>
        );
        pHandle.write(response);
        ns.print(
          `Responded with success='${scheduled.success}' host='${scheduled.host}'`
        );
      }
    }

    await ns.asleep(1);
  }
}

function scheduleRequest(
  ns: NS,
  stats: Stats,
  ramPool: string[],
  jobs: Record<string, SchedulerRequest[]>,
  request: SchedulerRequest
): SchedulerResponse {
  // select server with min available ram for duration of job
  let minRam = Infinity;
  let bestHost = "";
  for (const server of ramPool) {
    let ramAvail = stats.servers[server].maxRam;
    for (const job of jobs[server]) {
      // if jobs would overlap, we subtract the job's ram from available ram
      if (
        request.startTime - executeBufferTime < job.endTime ||
        request.endTime + executeBufferTime > job.startTime
      ) {
        ramAvail -= job.ram;
      }
    }
    // ns.print(`${server} has ${ramAvail} during requested time`);
    if (ramAvail >= request.ram && ramAvail < minRam) {
      minRam = ramAvail;
      bestHost = server;
    }
  }

  if (bestHost !== "") {
    jobs[bestHost].push(request);
    ns.print(
      `${bestHost} selected for ${request.ram}GB [${request.startTime}->${request.endTime}]`
    );
  } else {
    ns.print(
      `No host available for ${request.ram}GB [${request.startTime}->${request.endTime}]`
    );
  }
  // ns.print(`Jobs: ${JSON.stringify(jobs)}`);

  return {
    ram: request.ram,
    startTime: request.startTime,
    endTime: request.endTime,
    success: bestHost !== "",
    host: bestHost,
  };
}

async function printRamPoolStats(ns: NS, stats: Stats, ramPool: string[]) {
  const ram = { total: 0, used: 0 };

  for (const server of ramPool) {
    ram.total += stats.servers[server].maxRam;
    ram.used += stats.servers[server].ramUsed;
  }

  ns.print("RAM POOL STATS: ");
  ns.print(
    `    RAM used: (${ns.nFormat(
      ram.used / ram.total,
      "0.00%"
    )}) -->  ${ns.nFormat(ram.used, "0.0")} / ${ns.nFormat(ram.total, "0.0")}`
  );
  sendHUDRequest(
    ns,
    "Ram Pool",
    `${ns.nFormat(ram.used / ram.total, "0.00%")} (${ram.total})`
  );
}
