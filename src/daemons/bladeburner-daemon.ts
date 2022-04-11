import { NS } from "@ns";
import { sendHUDRequest } from "/modules/messaging";

interface ActionOption {
  type: string;
  name: string;
  priority: number;
  duration: number;
  count: number;
  successChance: [number, number];
}

const bonusTimeMultiplier = 5;

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

  // clean up HUD at exit
  ns.atExit(() => {
    try {
      sendHUDRequest(ns, "BB Rank", "", true);
    } catch {
      console.log("RIP");
    }
  });

  // some constants
  const contractsNames = ns.bladeburner.getContractNames();
  const operationsNames = ns.bladeburner.getOperationNames();
  const blackOpsNames = ns.bladeburner.getBlackOpNames();

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
    const staminaPercent = currentStamina / maxStamina;

    ns.print(
      `Stamina: ${ns.nFormat(staminaPercent * 100, "0.0")}% ${ns.nFormat(
        currentStamina,
        "0.00"
      )}/${ns.nFormat(maxStamina, "0.00")}`
    );

    // add all action options to the array with a calculated priority
    const actionOptions = [] as ActionOption[];

    // calculate contract options based on minimum success chance
    const contractsStats = contractsNames.map((name) =>
      getActionStats(ns, "contracts", name)
    );
    for (const contract of contractsStats) {
      contract.priority =
        contract.count <= 0
          ? 0
          : Math.pow(
              contract.successChance[0],
              Math.max(2 * (1 - staminaPercent), 0.5)
            ) * 0.8;
      actionOptions.push(contract);
    }

    // calculate operations options based on minimum success chance
    const operationsStats = operationsNames.map((name) =>
      getActionStats(ns, "operations", name)
    );
    for (const operation of operationsStats) {
      operation.priority =
        operation.count <= 0
          ? 0
          : Math.pow(operation.successChance[0], 3) * 0.9;
      actionOptions.push(operation);
    }

    // calculate black ops priority based on success chance
    const currentBlackOp = _.find(blackOpsNames, (name) =>
      ns.bladeburner.getActionCountRemaining("blackops", name)
    ) as string;
    const blackOp = getActionStats(ns, "blackops", currentBlackOp);
    blackOp.priority = Math.pow(blackOp.successChance[0], 5);
    actionOptions.push(blackOp);

    // find diff in success chance estimates
    const successRanges = [...contractsStats, ...operationsStats].map(
      (actionOption) =>
        actionOption.successChance[1] - actionOption.successChance[0]
    );

    // priority based on maximum variance in success estimate
    const fieldAnalysis = getActionStats(ns, "general", "Field Analysis");
    fieldAnalysis.priority = Math.max(...successRanges) > 0 ? 0.7 : 0.0;
    actionOptions.push(fieldAnalysis);

    // priority based on number of available contracts
    const inciteViolence = getActionStats(ns, "general", "Incite Violence");
    contractsStats.forEach((s) => {
      inciteViolence.priority +=
        (s.count > 0 ? 1 / s.count : 1.0) / contractsStats.length;
    });
    actionOptions.push(inciteViolence);

    // if we get really low on stamina, may be worth regenerating
    const regenChamber = getActionStats(
      ns,
      "general",
      "Hyperbolic Regeneration Chamber"
    );
    regenChamber.priority = Math.pow(1 - staminaPercent, 2);
    actionOptions.push(regenChamber);

    // if chaos gets really high, do some diplomacy
    const diplomacy = getActionStats(ns, "general", "Diplomacy");
    diplomacy.priority = Math.min(
      (ns.bladeburner.getCityChaos(ns.bladeburner.getCity()) / 30) *
        (1 - staminaPercent),
      0.95
    );
    actionOptions.push(diplomacy);

    // fallback option is always to do some training
    const training = getActionStats(ns, "general", "Training");
    training.priority = 0.5;
    actionOptions.push(training);

    // sort action options, highest priority first
    actionOptions.sort((a, b) => b.priority - a.priority);
    if (actionOptions.length === 0) {
      ns.print("No actions added to priorities");
      await ns.asleep(100);
      continue;
    } else {
      ns.print(
        `Action options: ${JSON.stringify(
          actionOptions.map((actionOption) => {
            return `${actionOption.name} ${ns.nFormat(
              actionOption.priority * 100,
              "0.00"
            )}%`;
          })
        )}`
      );
    }

    // pick best action and start it
    const bestAction = actionOptions[0];
    const started = ns.bladeburner.startAction(
      bestAction.type,
      bestAction.name
    );

    // check for bonus time
    const bonusTime = ns.bladeburner.getBonusTime();
    const duration =
      bonusTime > 1000
        ? Math.ceil(bestAction.duration / 1000 / bonusTimeMultiplier) * 1000
        : bestAction.duration;

    // update ui
    sendHUDRequest(ns, "BB Rank", ns.nFormat(ns.bladeburner.getRank(), "0.0a"));

    if (started) {
      ns.print(
        `Action ${bestAction.type} ${bestAction.name} started for ${duration}ms`
      );
      await ns.asleep(duration);
    } else {
      ns.print(`Action ${bestAction.type} ${bestAction.name} failed to start`);
      await ns.asleep(100);
    }
  } while (args["loop"]);
}

function getActionStats(ns: NS, type: string, name: string): ActionOption {
  return {
    type,
    name,
    priority: 0,
    duration: ns.bladeburner.getActionTime(type, name),
    count: ns.bladeburner.getActionCountRemaining(type, name),
    successChance: ns.bladeburner.getActionEstimatedSuccessChance(type, name),
  };
}
