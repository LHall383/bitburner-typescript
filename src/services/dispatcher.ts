import { NS } from "@ns";
import { unpackMessage } from "/modules/messaging";
import { ScheduledJob } from "/types.js";

const timeToExpiration = 250;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["port", 3]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Starting dispatcher----------");

  // start up the port and clear it
  const pHandle = ns.getPortHandle(args["port"]);
  pHandle.clear();
  ns.print(`Port ${args["port"]} opened and cleared`);

  // handle incoming service requests
  const scheduledJobs = [] as ScheduledJob[];
  ns.print("Ready for service requests!");
  while (true) {
    // check for port data, discarding bad data and old messages
    const parsed = unpackMessage<ScheduledJob>(ns, pHandle.peek());
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

      // handle dispatch request by inserting into the scheduledJobs array
      ns.print(`Received dispatch request from ${parsed.source}`);
      const insertIndex = _.sortedIndexBy(
        scheduledJobs,
        parsed.data,
        (j) => j.startTime
      );
      scheduledJobs.splice(insertIndex, 0, parsed.data);
      ns.print(
        `Inserted job at index ${insertIndex}, ${scheduledJobs.length} job(s) in queue`
      );
    }

    // if it's time for the top job, shift and service it
    const now = Date.now();
    if (scheduledJobs.length > 0 && scheduledJobs[0].startTime <= now) {
      const job = scheduledJobs.shift() as ScheduledJob;
      ns.print(
        `Time to service job: ${job.scriptName} on ${job.host} with threads ${job.threads} and args ${job.args}`
      );

      const start = performance.now();
      await ns.scp(job.scriptName, "home", job.host);
      const end = performance.now();
      ns.print(
        `Copying ${job.scriptName} to ${job.host} took ${ns.nFormat(
          end - start,
          "0.000"
        )} ms`
      );

      ns.enableLog("exec");
      const pid = ns.exec(job.scriptName, job.host, job.threads, ...job.args);
      ns.disableLog("exec");

      if (pid > 0) {
        ns.print(
          `Launched script '${job.name}' with PID: ${pid}, for ${ns.tFormat(
            job.endTime - job.startTime
          )}`
        );
      } else {
        ns.print(`Job failed to launch`);
        ns.toast(
          `Failed to launch ${job.name} on ${job.host} with threads ${job.threads}`,
          "warning"
        );
      }
    }

    await ns.sleep(1);
  }
}
