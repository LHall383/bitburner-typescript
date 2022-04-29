import { NS, Player, Server } from "@ns";
import { Stats } from "/types";

export async function connectToSever(
  ns: NS,
  end: string,
  start = "home",
  verbose = false
): Promise<string[]> {
  const stack = [[start]];
  let path: string[] = [];

  while (stack.length > 0) {
    path = stack.pop() ?? [""];
    if (verbose) ns.print(path);

    const end_node = path[path.length - 1];
    if (verbose) ns.print(end_node);
    if (end_node == end) {
      break;
    }

    const scan = (await getNsData(
      ns,
      `ns.scan('${end_node}')`,
      "/temp/scan"
    )) as string[];
    // ns.scan(end_node);
    if (verbose) ns.print(scan);
    scan.forEach((x) => {
      if (path.includes(x)) {
        return;
      }

      const extendedPath = _.cloneDeep(path);
      extendedPath.push(x);
      if (verbose) ns.print(extendedPath);
      stack.push(extendedPath);
    });

    await ns.asleep(10);
  }

  return path;
}

export async function customGetStats(
  ns: NS,
  servers: string[] = []
): Promise<Stats> {
  const stats = {
    player: (await getNsData(
      ns,
      "ns.getPlayer()",
      "/temp/get-player"
    )) as Player,
    servers: {},
  } as Stats;

  if (servers.length > 0) {
    stats.servers = (await getNsData(
      ns,
      "Object.fromEntries( JSON.parse(ns.args[0]).filter((s) => ns.serverExists(s)).map((s) => [s, ns.getServer(s)]) )",
      "/temp/get-servers",
      [JSON.stringify(servers)]
    )) as Record<string, Server>;
  }

  return stats;
}

const dataStore = {} as Record<string, { lastFetch: number; data: string }>;
export async function getNsData(
  ns: NS,
  command: string,
  fileName = undefined as string | undefined,
  args = [] as string[],
  maxAge = 10,
  verbose = false
): Promise<unknown> {
  const commandHash = hashCode(command + JSON.stringify(args));

  // check data store
  if (
    dataStore[commandHash] &&
    dataStore[commandHash].lastFetch > performance.now() - maxAge
  ) {
    if (verbose) {
      ns.print(
        `Using data store, fetched at ${msToTime(
          dataStore[commandHash].lastFetch
        )}`
      );
      ns.print(`Data: ${dataStore[commandHash].data}`);
    }
    return JSON.parse(dataStore[commandHash].data);
  }

  // generate data file name and command file name
  const fName = (fileName || `temp/${commandHash}_data`) + ".txt";
  const scriptName = (fileName || `/temp/${commandHash}_command`) + ".js";

  // create script and write to file
  const toFile =
    `let result="";try{result=JSON.stringify(` +
    command +
    `);}catch{} const f="${fName}"; if(ns.read(f)!=result) await ns.write(f,result,'w')`;
  const script =
    `export async function main(ns) { try { ` +
    toFile +
    `} catch(err) { ns.tprint(String(err)); throw(err); } }`;
  if (ns.read(scriptName) !== script) await ns.write(scriptName, script, "w");

  // execute script and wait for it to finish execution
  const pid = ns.run(scriptName, 1, ...args);
  for (let i = 0; i < 1000; i++) {
    if (!ns.isRunning(pid, "")) break;
    await ns.asleep(10);
  }

  // get results
  const result = ns.read(fName);
  if (verbose) ns.print(`Data: ${result}`);

  // put result in data store
  dataStore[commandHash] = { lastFetch: performance.now(), data: result };

  // read data from file and return
  let ret = undefined;
  try {
    ret = JSON.parse(result);
  } catch {
    ret = undefined;
  }
  return ret;
}

export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function msToTime(ms: number): string {
  const timeString = new Date(ms).toLocaleTimeString("en-US");
  const msString = ((ms % 1000) / 1000).toFixed(3).substring(1);
  const ts = [timeString.slice(0, -3), msString, timeString.slice(-3)].join("");
  return ts;
}

export async function scanServers(
  ns: NS,
  omitHome = false,
  omitPserv = false,
  maxDepth = 20
): Promise<string[]> {
  // seed server list
  const serverList = [];
  serverList.push(["home"]);
  const neighbors = (await getNsData(
    ns,
    "ns.scan('home')",
    "/temp/scan-home"
  )) as string[];
  serverList.push(neighbors);

  // mapping of all scans
  const scanMap = {} as Record<string, string[]>;

  // iteratively list more deeply connected servers
  for (let i = 1; i < maxDepth; i++) {
    const startList = serverList[i] as string[];
    const connectedList = [] as string[];

    // for each name at this level add the connected servers to the next level
    for (const name of startList) {
      if (!(name in scanMap)) {
        scanMap[name] = (await getNsData(
          ns,
          `ns.scan('${name}')`,
          `/temp/scan`
        )) as string[];
      }
      const scanList = scanMap[name];
      // verify servers and add
      for (const scannedName of scanList) {
        // dont add previously included servers
        if (
          scannedName == "home" ||
          connectedList.includes(scannedName) ||
          serverList[i - 1].includes(scannedName)
        ) {
          continue;
        }
        connectedList.push(scannedName);
      }
    }

    // ns.print(connectedList);
    serverList.push(connectedList);
  }

  // flatten server list into normal array
  const flattened = serverList
    .join()
    .split(",")
    .filter((s) => s !== "");

  // remove if requested
  if (omitHome) _.remove(flattened, (hostname) => hostname === "home");
  if (omitPserv) _.remove(flattened, (hostname) => hostname.includes("pserv"));

  return flattened;
}
