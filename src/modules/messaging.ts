import { NetscriptPort, NS } from "@ns";
import { hashCode } from "/modules/helper";
import { HUDRequest, Message, MessageResponse } from "/types";

export function createMessage<T>(
  source: string,
  text: string,
  data: T
): Message<T> {
  return {
    hash: hashCode(source + text + JSON.stringify(data)),
    timeSent: Date.now(),
    source,
    text,
    data,
  } as Message<T>;
}

export function packMessage<T>(ns: NS, text: string, data: T): string {
  const packedMessage = createMessage(ns.getScriptName(), text, data);
  return JSON.stringify(packedMessage);
}

export function unpackMessage<T>(
  ns: NS,
  message: string | number
): Message<T> | undefined {
  if (typeof message === "number" || message === "NULL PORT DATA")
    return undefined;
  const parsed = JSON.parse(message) as Message<T>;
  return parsed;
}

export async function sendReceive<T, K>(
  ns: NS,
  port: number | NetscriptPort,
  message: Message<T>,
  timeout = 500
): Promise<Message<MessageResponse<K>> | undefined> {
  // get start time for timeout
  const start = Date.now();

  // pack message
  const packedMessage = JSON.stringify(message);

  // get port handle
  const portHandle = typeof port === "number" ? ns.getPortHandle(port) : port;

  // write message to port
  while (!portHandle.tryWrite(packedMessage)) {
    if (Date.now() > start + timeout) break;
    await ns.asleep(1);
  }

  // wait for response on port
  let response = undefined;
  while (true) {
    if (Date.now() > start + timeout) break;

    const m = unpackMessage<MessageResponse<K>>(ns, portHandle.peek());
    if (
      m &&
      m.data &&
      m.data.sourceMessage &&
      m.data.sourceMessage.hash === message.hash &&
      m.data.sourceMessage.source === message.source
    ) {
      response = unpackMessage<MessageResponse<K>>(ns, portHandle.read());
      break;
    }
    await ns.asleep(1);
  }

  return response;
}

export async function getSchedulerMaxRam(
  ns: NS,
  schedulerPort: number
): Promise<number> {
  const ramMessage = createMessage(
    ns.getScriptName() + JSON.stringify(ns.args),
    "Max ram request",
    0
  );
  const res = await sendReceive<number, number>(ns, schedulerPort, ramMessage);
  return res?.data.data || 0;
}

export function sendHUDRequest(
  ns: NS,
  header: string,
  fValue: string,
  remove = false,
  overviewStatsPort = 20
): void {
  const pHandle = ns.getPortHandle(overviewStatsPort);
  const packed = packMessage(ns, `HUD Request from ${ns.getScriptName()}`, {
    id: header,
    header,
    fValue,
    remove,
  } as HUDRequest);
  pHandle.write(packed);
}
