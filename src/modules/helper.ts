import { NS, Server } from "@ns";
import { Stats } from "/types";

const dataStore = {} as Record<string, { lastFetch: number; data: string }>;
export async function getDataThroughFile(
  ns: NS,
  command: string,
  fileName: string,
  maxAge = 0,
  verbose = false
): Promise<unknown> {
  // check data store
  if (
    dataStore[command] &&
    dataStore[command].lastFetch > performance.now() - maxAge
  ) {
    if (verbose) {
      ns.print(
        `Using data store, fetched at ${msToTime(dataStore[command].lastFetch)}`
      );
      ns.print(`Data: ${dataStore[command].data}`);
    }
    return JSON.parse(dataStore[command].data);
  }

  // generate data file name and command file name
  const commandHash = hashCode(command);
  const fName = fileName || `temp/data_${commandHash}`;
  const scriptName = (fName || `/temp/command_${commandHash}`) + ".js";

  // create script
  const toFile =
    `let result="";try{result=JSON.stringify(` +
    command +
    `);}catch{} const f="${fName}"; if(ns.read(f)!=result) await ns.write(f,result,'w')`;
  const script =
    `export async function main(ns) { try { ` +
    toFile +
    `} catch(err) { ns.tprint(String(err)); throw(err); } }`;
  await ns.write(scriptName, script, "w");

  // execute script and wait for it to finish execution
  const pid = ns.run(scriptName, 1);
  for (let i = 0; i < 1000; i++) {
    if (!ns.isRunning(pid, "")) break;
    await ns.asleep(10);
  }

  // get results
  const result = ns.read(fName);
  if (verbose) ns.print(`Data: ${result}`);

  // put result in data store
  dataStore[command] = { lastFetch: performance.now(), data: result };

  // read data from file and return
  return JSON.parse(result);
}

export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export async function connectToSever(
  ns: NS,
  end: string,
  start = "home"
): Promise<string[]> {
  const stack = [[start]];
  let path: string[] = [];

  while (stack.length > 0) {
    path = stack.pop() ?? [""];
    ns.print(path);

    const end_node = path[path.length - 1];
    ns.print(end_node);
    if (end_node == end) {
      break;
    }

    const scan = ns.scan(end_node);
    ns.print(scan);
    scan.forEach((x) => {
      if (path.includes(x)) {
        return;
      }

      const extendedPath = _.cloneDeep(path);
      extendedPath.push(x);
      ns.print(extendedPath);
      stack.push(extendedPath);
    });

    await ns.sleep(1);
  }

  return path;
}

export function customGetStats(ns: NS, servers: string[] = []): Stats {
  const stats = {
    player: ns.getPlayer(),
    servers: {},
  } as Stats;
  servers.forEach((s) => {
    if (ns.serverExists(s)) stats.servers[s] = ns.getServer(s) as Server;
  });
  return stats;
}

export function msToTime(ms: number): string {
  const timeString = new Date(ms).toLocaleTimeString("en-US");
  const msString = ((ms % 1000) / 1000).toFixed(3).substring(1);
  const ts = [timeString.slice(0, -3), msString, timeString.slice(-3)].join("");
  return ts;
}
