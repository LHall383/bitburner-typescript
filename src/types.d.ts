import { Player, Server } from "@ns";

export interface TimedCall {
  lastCalled: number;
  callEvery: number;
  callback: () => Promise<void>;
}

export interface HUDRow {
  header: string;
  fValue: string;
}

export interface Stats {
  player: Player;
  servers: Record<string, Server>;
}

export interface ScriptInfo {
  name: string;
  ram: number;
}

export interface ScriptsInfo {
  hackScript: ScriptInfo;
  growScript: ScriptInfo;
  weakenScript: ScriptInfo;
}

export interface SchedulerRequest {
  ram: number;
  startTime: number;
  endTime: number;
}

export interface SchedulerResponse extends SchedulerRequest {
  success: boolean;
  host?: string;
}

export interface Job {
  name: string;
  scriptName: string;
  startTime: number;
  endTime: number;
  threads: number;
  ram: number;
  args: string[];
}

export interface ScheduledJob extends Job {
  host: string;
}

export interface Message<T> {
  hash: number;
  timeSent: number;
  source: string;
  text: string;
  data: T;
}

export interface MessageResponse<T> {
  sourceMessage: Message<T>;
  data: T;
}
