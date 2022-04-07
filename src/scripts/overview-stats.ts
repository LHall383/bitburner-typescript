/**
 * Most of this file is based on alainbryden's stat HUD.
 * https://github.com/alainbryden/bitburner-scripts/blob/main/stats.js
 */

import { NS } from "@ns";
import { HUDRow } from "/types";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep");

  // get overview html elements
  const doc = eval("document") as Document;
  const hook0 = doc.getElementById("overview-extra-hook-0");
  const hook1 = doc.getElementById("overview-extra-hook-1");

  if (hook0 === null || hook1 === null) {
    ns.print("Could not get overview hooks");
    return;
  }

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
    hudData.push({ header, fValue } as HUDRow);

  // constants that don't change
  const dictSourceFiles = Object.fromEntries(
    ns.getOwnedSourceFiles().map((sf) => [sf.n, sf.lvl])
  );

  // Main stats update loop
  while (true) {
    // constants that do change
    const playerInfo = ns.getPlayer();

    try {
      // show script income and exp gain stats
      addHud("ScrInc", ns.nFormat(ns.getScriptIncome()[0], "$0.0a") + "/sec");
      addHud(
        "ScrIncAug",
        ns.nFormat(ns.getScriptIncome()[1], "$0.0a") + "/sec"
      );
      addHud("ScrExp", ns.nFormat(ns.getScriptExpGain(), "0.0a") + "/sec");

      // show karma (for some reason this isn't in the bitburner type defs)
      addHud("Karma", ns.nFormat(eval("ns.heart.break()"), "0.0a"));

      // add bladeburner data if Bladeburner API unlocked
      if (
        playerInfo.inBladeburner &&
        (7 in dictSourceFiles || 7 == playerInfo.bitNodeN)
      ) {
        const bbRank = ns.bladeburner.getRank();
        const bbSP = ns.bladeburner.getSkillPoints();
        addHud("BB Rank", ns.nFormat(bbRank, "0.0a"));
        addHud("BB SP", ns.nFormat(bbSP, "0.0a"));
      }

      // Clear the previous loop's custom HUDs
      hook1.innerHTML = hook0.innerHTML = "";
      // Create new HUD elements with info collected above.
      for (const hudRow of hudData) {
        hook0.appendChild(newline(hudRow.header));
        hook1.appendChild(newline(hudRow.fValue));
      }
      hudData.length = 0; // Clear the hud data for the next iteration
    } catch (err) {
      // Might run out of ram from time to time, since we use it dynamically
      ns.print("ERROR: Update Skipped: " + String(err));
    }

    await ns.sleep(1000);
  }
}
