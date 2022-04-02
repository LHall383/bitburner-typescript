import { NS } from "@ns";

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export interface Message<T> {
  hash: number;
  source: string;
  text: string;
  data: T;
}

export interface MessageResponse<T> {
  sourceMessage: Message<T>;
  data: T;
}

export function createMessage<T>(
  source: string,
  text: string,
  data: T
): Message<T> {
  return {
    hash: hashCode(source + text + JSON.stringify(data)),
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
  port: number,
  message: Message<T>,
  timeout = 500
): Promise<Message<MessageResponse<K>> | undefined> {
  // pack message
  const packedMessage = JSON.stringify(message);

  // get port handle
  const portHandle = ns.getPortHandle(port);

  // write message to port
  while (!portHandle.tryWrite(packedMessage)) await ns.sleep(1);

  // wait for response on port
  let response = undefined;
  for (let i = 0; i < timeout; i++) {
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
    await ns.sleep(1);
  }

  return response;
}
