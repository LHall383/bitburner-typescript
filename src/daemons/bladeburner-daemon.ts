import { NS } from "@ns";

interface ActionOption {
  type: string;
  name: string;
  priority: number;
  duration: number;
}

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["loop", true]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Staring bladeburner daemon----------");

  // make sure we are in the bladeburner division
  while (!ns.bladeburner.joinBladeburnerDivision()) {
    ns.print("Not currently in bladeburner division, waiting to join");
    await ns.sleep(1000);
  }

  do {
    // handle upgrades
    const skillOptions = ns.bladeburner.getSkillNames().map((name) => {
      return { name, cost: ns.bladeburner.getSkillUpgradeCost(name) };
    });
    skillOptions.sort((a, b) => a.cost - b.cost);
    if (
      skillOptions.length > 0 &&
      ns.bladeburner.getSkillPoints() > skillOptions[0].cost
    ) {
      ns.bladeburner.upgradeSkill(skillOptions[0].name);
      ns.print(
        `Upgrading ${skillOptions[0].name} for ${skillOptions[0].cost} SP`
      );
    }

    const [currentStamina, maxStamina] = ns.bladeburner.getStamina();
    const lowStamina = maxStamina * 0.5;

    ns.print(
      `Stamina: ${ns.nFormat(
        (currentStamina / maxStamina) * 100,
        "0.0"
      )}% ${ns.nFormat(currentStamina, "0.00")}/${ns.nFormat(
        maxStamina,
        "0.00"
      )}`
    );

    // handle action
    const actionOptions = [] as ActionOption[];
    if (currentStamina < lowStamina) {
      actionOptions.push({
        type: "general",
        name: "Field Analysis",
        priority: 1.0,
        duration: ns.bladeburner.getActionTime("general", "Field Analysis"),
      });
    } else {
      actionOptions.push({
        type: "contracts",
        name: "Tracking",
        priority:
          ns.bladeburner.getActionCountRemaining("contracts", "Tracking") > 0
            ? 1.0
            : 0.0,
        duration: ns.bladeburner.getActionTime("contracts", "Tracking"),
      });
      actionOptions.push({
        type: "contracts",
        name: "Retirement",
        priority:
          ns.bladeburner.getActionCountRemaining("contracts", "Retirement") > 0
            ? 0.8
            : 0.0,
        duration: ns.bladeburner.getActionTime("contracts", "Retirement"),
      });
      actionOptions.push({
        type: "contracts",
        name: "Bounty Hunter",
        priority:
          ns.bladeburner.getActionCountRemaining("contracts", "Bounty Hunter") >
          0
            ? 0.6
            : 0.0,
        duration: ns.bladeburner.getActionTime("contracts", "Bounty Hunter"),
      });
    }

    // sort action options, highest priority first
    actionOptions.sort((a, b) => b.priority - a.priority);
    if (actionOptions.length === 0) {
      ns.print("No actions added to priorities");
      await ns.sleep(100);
      continue;
    }

    const bestAction = actionOptions[0];
    const started = ns.bladeburner.startAction(
      bestAction.type,
      bestAction.name
    );
    if (started) {
      ns.print(
        `Action ${bestAction.type} ${bestAction.name} started for ${bestAction.duration}ms`
      );
      await ns.sleep(bestAction.duration);
    } else {
      ns.print(`Action ${bestAction.type} ${bestAction.name} failed to start`);
      await ns.sleep(100);
    }

    await ns.sleep(1);
  } while (args["loop"]);
}
