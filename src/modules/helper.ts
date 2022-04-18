import { NS, Server } from "@ns";
import { Stats } from "/types";

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
