/**
 * This file is based on alainbryden's stat HUD.
 * https://github.com/alainbryden/bitburner-scripts/blob/main/stats.js
 */

import { NS } from "@ns";
import { unpackMessage } from "/modules/messaging";
import { HUDRow, HUDRequest } from "/types";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["port", 20]]);

  ns.disableLog("sleep");

  // get overview html elements
  const doc = eval("document") as Document;
  const hook0 = doc.getElementById("overview-extra-hook-0");
  const hook1 = doc.getElementById("overview-extra-hook-1");
  if (hook0 === null || hook1 === null) {
    ns.print("Could not get overview hooks");
    return;
  }
  ns.atExit(() => {
    hook0.innerHTML = "";
    hook1.innerHTML = "";
  });

  // Logic for adding a single custom HUD entry
  const newline = (txt: string, tt = "") => {
    const p = doc.createElement("p");
    p.appendChild(doc.createTextNode(txt));
    p.setAttribute("style", "margin: 0");
    p.title = tt;
    return p;
  };
  const hudData = [] as HUDRow[];
  const addHud = (header: string, fValue: string) =>
    hudData.push({ header: `${header}: `, fValue } as HUDRow);

  // init port and clear
  const pHandle = ns.getPortHandle(args["port"]);
  pHandle.clear();
  ns.print(`Init and cleared port ${args["port"]}`);

  // constants used in loop
  const externalAdditions = {} as Record<string, HUDRow>;

  // Main stats update loop
  while (true) {
    // show script income and exp gain stats
    addHud("ScrInc", ns.nFormat(ns.getScriptIncome()[0], "$0.0a") + "/sec");
    addHud("ScrIncAug", ns.nFormat(ns.getScriptIncome()[1], "$0.0a") + "/sec");
    addHud("ScrExp", ns.nFormat(ns.getScriptExpGain(), "0.0a") + "/sec");

    // show karma (for some reason this isn't in the bitburner type defs)
    addHud("Karma", ns.nFormat(eval("ns.heart.break()"), "0.0a"));

    // add data from incoming messages
    while (!pHandle.empty()) {
      const message = unpackMessage<HUDRequest>(ns, pHandle.read());
      if (message === undefined) continue;
      if (message.data.remove) {
        delete externalAdditions[message.data.id];
      } else {
        externalAdditions[message.data.id] = {
          header: message.data.header,
          fValue: message.data.fValue,
        } as HUDRow;
      }
    }
    ns.print(`Adding: ${JSON.stringify(externalAdditions)}`);

    // append external additions to HUD
    for (const id in externalAdditions) {
      const toAdd = externalAdditions[id];
      if (toAdd) addHud(toAdd.header, toAdd.fValue);
    }

    // Clear the previous loop's custom HUDs
    hook0.innerHTML = "";
    hook1.innerHTML = "";
    // Create new HUD elements with info collected above.
    for (const hudRow of hudData) {
      hook0.appendChild(newline(hudRow.header));
      hook1.appendChild(newline(hudRow.fValue));
    }
    hudData.length = 0; // Clear the hud data for the next iteration

    await ns.sleep(1000);
  }
}
