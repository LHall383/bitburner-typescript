import { BladeburnerCurAction, NS } from "@ns";
import { getNsData } from "/modules/helper";
import { sendHUDRequest } from "/modules/messaging";

interface ActionOption {
  type: string;
  name: string;
  priority: number;
  duration: number;
  count: number;
  successChance: [number, number];
  repPerSec: number;
}

const bonusTimeMultiplier = 5;

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["loop", true]]);

  // we do our own logging
  ns.disableLog("ALL");
  ns.print("----------Staring bladeburner daemon----------");

  // make sure we are in the bladeburner division
  let inBB = (await getNsData(
    ns,
    "ns.bladeburner.joinBladeburnerDivision()",
    "/temp/bb-in-bb"
  )) as boolean;
  while (!inBB) {
    ns.print("Not currently in bladeburner division, waiting to join");
    await ns.asleep(1000);
    inBB = (await getNsData(
      ns,
      "ns.bladeburner.joinBladeburnerDivision()",
      "/temp/bb-in-bb"
    )) as boolean;
  }

  // clean up HUD at exit
  ns.atExit(() => {
    try {
      sendHUDRequest(ns, "BB Rank", "", true);
    } catch {
      console.log("RIP");
    }
  });

  // constants and data that doesn't change
  const contractsNames = (await getNsData(
    ns,
    "ns.bladeburner.getContractNames()",
    "/temp/bb-contract-names"
  )) as string[];
  const operationsNames = (await getNsData(
    ns,
    "ns.bladeburner.getOperationNames()",
    "/temp/bb-operation-names"
  )) as string[];
  const blackOpsNames = (await getNsData(
    ns,
    "ns.bladeburner.getBlackOpNames()",
    "/temp/bb-operation-names"
  )) as string[];
  const blackOpsRanks = (await getNsData(
    ns,
    "Object.fromEntries(JSON.parse(ns.args[0]).map((n) => [n, ns.bladeburner.getBlackOpRank(n)]))",
    "/temp/bb-operation-names",
    [JSON.stringify(blackOpsNames)]
  )) as Record<string, number>;
  const skillNames = (await getNsData(
    ns,
    "ns.bladeburner.getSkillNames()",
    "/temp/bb-skill-names"
  )) as string[];
  const prioritizeRep = true;

  do {
    const loopStart = performance.now();

    // handle upgrades
    while (true) {
      const skillOptions = skillNames.map((name) => {
        let cost = ns.bladeburner.getSkillUpgradeCost(name);
        if (name == "Overclock" && ns.bladeburner.getSkillLevel(name) >= 90)
          cost = Number.MAX_VALUE;
        return { name, cost };
      });
      skillOptions.sort((a, b) => a.cost - b.cost);
      if (
        skillOptions.length > 0 &&
        ns.bladeburner.getSkillPoints() >= skillOptions[0].cost
      ) {
        ns.bladeburner.upgradeSkill(skillOptions[0].name);
        ns.print(
          `Upgrading ${skillOptions[0].name} for ${skillOptions[0].cost} SP`
        );
        await ns.asleep(10);
      } else {
        break;
      }
    }

    // get some stats every loop
    const [currentStamina, maxStamina] = (await getNsData(
      ns,
      "ns.bladeburner.getStamina()",
      "/temp/bb-stamina"
    )) as [number, number];
    const staminaPercent = currentStamina / maxStamina;
    const rank = (await getNsData(
      ns,
      "ns.bladeburner.getRank()",
      "/temp/bb-rank"
    )) as number;

    // update ui
    sendHUDRequest(ns, "BB Rank", ns.nFormat(rank, "0.0a"));

    ns.print(
      `Stamina: ${ns.nFormat(staminaPercent * 100, "0.0")}% ${ns.nFormat(
        currentStamina,
        "0.00"
      )}/${ns.nFormat(maxStamina, "0.00")}`
    );

    // add all action options to the array with a calculated priority
    const actionOptions = [] as ActionOption[];

    // calculate contract options based on minimum success chance and rep
    const contractsStats = contractsNames.map((name) =>
      getActionStats(ns, "contracts", name)
    );
    const maxRepPerSec = Math.max(...contractsStats.map((c) => c.repPerSec));
    const cSuccessPower = Math.max(2 * (1 - staminaPercent), 0.5);
    for (const contract of contractsStats) {
      if (contract.count <= 0) {
        contract.priority = 0;
      } else {
        contract.priority =
          0.8 * Math.pow(contract.successChance[0], cSuccessPower);
        if (prioritizeRep)
          contract.priority *= contract.repPerSec / maxRepPerSec;
      }
      actionOptions.push(contract);
    }

    // calculate operations options based on minimum success chance and rep
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
    blackOp.priority = Math.pow(
      blackOp.successChance[0],
      Math.max((5 * blackOpsRanks[currentBlackOp]) / rank, 2)
    );
    actionOptions.push(blackOp);

    // find diff in success chance estimates
    const successRanges = [...contractsStats, ...operationsStats, blackOp].map(
      (actionOption) =>
        actionOption.successChance[1] - actionOption.successChance[0]
    );

    // priority based on maximum variance in success estimate
    const fieldAnalysis = getActionStats(ns, "general", "Field Analysis");
    fieldAnalysis.priority = Math.max(...successRanges) > 0 ? 0.79 : 0.0;
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
        Math.max(1 - staminaPercent, 0.5),
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

    // pick best action and switch to it if it doesn't match best action
    const bestAction = actionOptions[0];
    const currentAction = (await getNsData(
      ns,
      "ns.bladeburner.getCurrentAction()",
      "/temp/bb-current-action"
    )) as BladeburnerCurAction;
    if (
      bestAction.type === currentAction.type &&
      bestAction.name === currentAction.name
    ) {
      ns.print(
        `Already executing best action: ${bestAction.type} ${bestAction.name}`
      );
      await ns.asleep(100);
      continue;
    }
    const started = (await getNsData(
      ns,
      `ns.bladeburner.startAction(ns.args[0],ns.args[1])`,
      "/temp/bb-start-action",
      [bestAction.type, bestAction.name]
    )) as boolean;

    // modify duration based on bonus time
    const bonusTime = ns.bladeburner.getBonusTime();
    const duration =
      bonusTime > bestAction.duration
        ? Math.ceil(bestAction.duration / 1000 / bonusTimeMultiplier) * 1000
        : bestAction.duration;

    const loopEnd = performance.now();
    ns.print(`Loop took ${loopEnd - loopStart} ms`);

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
  const level = ns.bladeburner.getActionCurrentLevel(type, name);
  const rep = ns.bladeburner.getActionRepGain(type, name, level);
  const duration = ns.bladeburner.getActionTime(type, name);

  return {
    type,
    name,
    priority: 0,
    duration,
    count: ns.bladeburner.getActionCountRemaining(type, name),
    successChance: ns.bladeburner.getActionEstimatedSuccessChance(type, name),
    repPerSec: rep / (duration / 1000),
  };
}
