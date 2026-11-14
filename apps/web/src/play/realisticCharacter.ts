import { Bone, Euler, type Object3D, Quaternion, Vector3 } from "three";

function pointBone(root: Object3D, bone: Bone, child: Bone, direction: Vector3) {
  root.updateMatrixWorld(true);
  const current = child
    .getWorldPosition(new Vector3())
    .sub(bone.getWorldPosition(new Vector3()))
    .normalize();
  const rotation = bone.getWorldQuaternion(new Quaternion());
  const delta = new Quaternion().setFromUnitVectors(current, direction.normalize());
  const parent = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  bone.quaternion.copy(parent.invert().multiply(delta.multiply(rotation)));
  root.updateMatrixWorld(true);
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function createRealisticCharacterMotion(root: Object3D, seatedForearmY = -0.1) {
  const bone = (name: string) => {
    const object = root.getObjectByName(name);
    return object instanceof Bone ? object : undefined;
  };
  const leftArm = bone("LeftArm"),
    leftForearm = bone("LeftForeArm"),
    leftHand = bone("LeftHand");
  const rightArm = bone("RightArm"),
    rightForearm = bone("RightForeArm"),
    rightHand = bone("RightHand");
  if (!leftArm || !leftForearm || !leftHand || !rightArm || !rightForearm || !rightHand)
    return null;

  pointBone(root, leftArm, leftForearm, new Vector3(0.14, -1, 0.04));
  pointBone(root, leftForearm, leftHand, new Vector3(0.07, -1, 0.17));
  pointBone(root, rightArm, rightForearm, new Vector3(-0.14, -1, 0.04));
  pointBone(root, rightForearm, rightHand, new Vector3(-0.07, -1, 0.17));

  const digits: { bone: Bone; rest: Quaternion }[] = [];
  // Relax the source's spread, straight T-pose fingers into a loose resting hand.
  for (const side of ["Left", "Right"]) {
    for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
      for (const [joint, curl] of [
        [1, 0.08],
        [2, 0.22],
        [3, 0.16],
      ] as const) {
        const digit = bone(`${side}Hand${finger}${joint}`);
        if (digit) {
          digit.rotateX(curl);
          digits.push({ bone: digit, rest: digit.quaternion.clone() });
        }
      }
    }
  }
  const armRest = rightArm.quaternion.clone(),
    forearmRest = rightForearm.quaternion.clone(),
    handRest = rightHand.quaternion.clone();
  const leftArmRest = leftArm.quaternion.clone(),
    leftForearmRest = leftForearm.quaternion.clone(),
    leftHandRest = leftHand.quaternion.clone();
  pointBone(root, rightArm, rightForearm, new Vector3(-0.8, -0.28, 0.22));
  const armWave = rightArm.quaternion.clone();
  pointBone(root, rightForearm, rightHand, new Vector3(0.1, 0.96, 0.25));
  const forearmWave = rightForearm.quaternion.clone();
  rightArm.quaternion.copy(armRest);
  rightForearm.quaternion.copy(forearmRest);
  pointBone(root, rightArm, rightForearm, new Vector3(-0.2, -0.55, 0.8));
  const armReach = rightArm.quaternion.clone();
  pointBone(root, rightForearm, rightHand, new Vector3(0.1, 0.15, 1));
  const forearmReach = rightForearm.quaternion.clone();
  rightArm.quaternion.copy(armRest);
  rightForearm.quaternion.copy(forearmRest);
  pointBone(root, rightArm, rightForearm, new Vector3(-0.12, -0.85, 0.5));
  const rightArmSeated = rightArm.quaternion.clone();
  pointBone(root, rightForearm, rightHand, new Vector3(0.2, seatedForearmY, 1));
  const rightForearmSeated = rightForearm.quaternion.clone();
  pointBone(root, leftArm, leftForearm, new Vector3(0.12, -0.85, 0.5));
  const leftArmSeated = leftArm.quaternion.clone();
  pointBone(root, leftForearm, leftHand, new Vector3(-0.2, seatedForearmY, 1));
  const leftForearmSeated = leftForearm.quaternion.clone();
  pointBone(root, leftArm, leftForearm, new Vector3(0.02, -0.85, 0.5));
  const leftArmTyping = leftArm.quaternion.clone();
  pointBone(root, leftForearm, leftHand, new Vector3(-0.35, -0.03, 1));
  const leftForearmTyping = leftForearm.quaternion.clone();
  pointBone(root, rightArm, rightForearm, new Vector3(-0.02, -0.85, 0.5));
  const rightArmTyping = rightArm.quaternion.clone();
  pointBone(root, rightForearm, rightHand, new Vector3(0.35, -0.03, 1));
  const rightForearmTyping = rightForearm.quaternion.clone();
  // Restore seated arm targets before calibrating the resting palms.
  leftArm.quaternion.copy(leftArmSeated);
  leftForearm.quaternion.copy(leftForearmSeated);
  rightArm.quaternion.copy(rightArmSeated);
  rightForearm.quaternion.copy(rightForearmSeated);
  root.updateMatrixWorld(true);
  // The source hands are edge-on in the seated pose. Flatten the palms so fingers
  // rest above the desk rather than pointing through its surface.
  const seatedHand = (hand: Bone, side: "Left" | "Right") => {
    const middle = bone(`${side}HandMiddle1`),
      index = bone(`${side}HandIndex1`),
      pinky = bone(`${side}HandPinky1`);
    if (!middle || !index || !pinky) return hand.quaternion.clone();
    pointBone(root, hand, middle, new Vector3(side === "Left" ? -0.12 : 0.12, 0, 1));
    const forward = middle
      .getWorldPosition(new Vector3())
      .sub(hand.getWorldPosition(new Vector3()))
      .normalize();
    const across = index
      .getWorldPosition(new Vector3())
      .sub(pinky.getWorldPosition(new Vector3()))
      .projectOnPlane(forward)
      .normalize();
    const desired = new Vector3(side === "Left" ? -1 : 1, 0, 0).projectOnPlane(forward).normalize();
    const angle = Math.atan2(forward.dot(across.clone().cross(desired)), across.dot(desired));
    const world = hand.getWorldQuaternion(new Quaternion());
    const parent = hand.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    hand.quaternion.copy(
      parent.invert().multiply(new Quaternion().setFromAxisAngle(forward, angle).multiply(world)),
    );
    root.updateMatrixWorld(true);
    return hand.quaternion.clone();
  };
  const leftHandSeated = seatedHand(leftHand, "Left");
  const rightHandSeated = seatedHand(rightHand, "Right");
  leftHand.quaternion.copy(leftHandRest);
  rightHand.quaternion.copy(handRest);
  leftArm.quaternion.copy(leftArmRest);
  leftForearm.quaternion.copy(leftForearmRest);
  rightArm.quaternion.copy(armRest);
  rightForearm.quaternion.copy(forearmRest);
  root.updateMatrixWorld(true);

  const head = bone("Head"),
    spine = bone("Spine"),
    chest = bone("Spine2");
  const headRest = head?.quaternion.clone(),
    spineRest = spine?.quaternion.clone(),
    chestRest = chest?.quaternion.clone();
  const headTyping = headRest
    ?.clone()
    .multiply(new Quaternion().setFromEuler(new Euler(0.13, 0, 0)));
  if (head) {
    for (const name of ["Teeth_Upper.001", "Teeth_Upper.002"]) {
      const teeth = root.getObjectByName(name) ?? root.getObjectByName(name.replaceAll(".", ""));
      if (teeth && teeth.parent !== head) head.attach(teeth);
    }
  }
  let elapsed = 0,
    previousWave = 0,
    waveStart = Number.NEGATIVE_INFINITY;
  let previousMood = "calm",
    nodStart = Number.NEGATIVE_INFINITY,
    look = 0,
    thinkingWeight = 0,
    concernedWeight = 0;
  const rotation = new Quaternion(),
    angles = new Euler();
  const legs = ["Left", "Right"].map((side) => {
    const thigh = bone(`${side}UpLeg`),
      knee = bone(`${side}Leg`),
      foot = bone(`${side}Foot`);
    const thighRest = thigh?.quaternion.clone(),
      kneeRest = knee?.quaternion.clone();
    if (thigh && knee && foot) {
      pointBone(root, thigh, knee, new Vector3(0, -0.06, 1));
      pointBone(root, knee, foot, new Vector3(0, -1, 0.04));
    }
    const thighSeated = thigh?.quaternion.clone(),
      kneeSeated = knee?.quaternion.clone();
    if (thigh && thighRest) thigh.quaternion.copy(thighRest);
    if (knee && kneeRest) knee.quaternion.copy(kneeRest);
    root.updateMatrixWorld(true);
    return {
      thigh,
      knee,
      foot,
      thighRest,
      kneeRest,
      thighSeated,
      kneeSeated,
      footRest: foot?.quaternion.clone(),
      thighAxis: thigh
        ? new Vector3(1, 0, 0)
            .applyQuaternion(root.getWorldQuaternion(new Quaternion()))
            .applyQuaternion(thigh.getWorldQuaternion(new Quaternion()).invert())
        : new Vector3(1, 0, 0),
      kneeAxis: knee
        ? new Vector3(1, 0, 0)
            .applyQuaternion(root.getWorldQuaternion(new Quaternion()))
            .applyQuaternion(knee.getWorldQuaternion(new Quaternion()).invert())
        : new Vector3(1, 0, 0),
      footAxis: foot
        ? new Vector3(1, 0, 0)
            .applyQuaternion(root.getWorldQuaternion(new Quaternion()))
            .applyQuaternion(foot.getWorldQuaternion(new Quaternion()).invert())
        : new Vector3(1, 0, 0),
    };
  });
  // Bone-local X is sideways on this rig. Convert the actor's left/right axis
  // into each resting upper arm's coordinates, so swing follows his facing direction.
  root.updateMatrixWorld(true);
  const actorRight = new Vector3(1, 0, 0).applyQuaternion(
    root.getWorldQuaternion(new Quaternion()),
  );
  const leftSwingAxis = actorRight
    .clone()
    .applyQuaternion(leftArm.getWorldQuaternion(new Quaternion()).invert())
    .normalize();
  const rightSwingAxis = actorRight
    .clone()
    .applyQuaternion(rightArm.getWorldQuaternion(new Quaternion()).invert())
    .normalize();
  function offset(
    object: Object3D | undefined,
    rest: Quaternion | undefined,
    x: number,
    y: number,
    z: number,
  ) {
    if (!object || !rest) return;
    angles.set(x, y, z);
    rotation.setFromEuler(angles);
    object.quaternion.copy(rest).multiply(rotation);
  }
  return {
    update(
      delta: number,
      wave: number,
      reducedMotion: boolean,
      mood = "calm",
      pointerX = 0,
      travel?: { walk: number; stride: number; reach: number; sit?: number },
      typing = 0,
    ) {
      elapsed += delta;
      if (wave !== previousWave) {
        previousWave = wave;
        // Repeated clicks do not snap an already raised arm back to its starting pose.
        if (!reducedMotion && elapsed - waveStart > 3.6) waveStart = elapsed;
      }
      if (mood !== previousMood) {
        if (mood === "pleased") nodStart = elapsed;
        previousMood = mood;
      }
      const age = elapsed - waveStart;
      const armWeight = reducedMotion ? 0 : smooth(age / 0.8) * (1 - smooth((age - 2.45) / 1.05));
      const elbowWeight = reducedMotion
        ? 0
        : smooth((age - 0.18) / 0.82) * (1 - smooth((age - 2.3) / 0.95));
      const wristWeight = reducedMotion
        ? 0
        : smooth((age - 0.75) / 0.35) * (1 - smooth((age - 2.05) / 0.4));
      const moodBlend = reducedMotion ? 1 : 1 - Math.exp(-delta * 5);
      thinkingWeight +=
        ((!reducedMotion && mood === "thinking" ? 1 : 0) - thinkingWeight) * moodBlend;
      concernedWeight +=
        ((!reducedMotion && mood === "concerned" ? 1 : 0) - concernedWeight) * moodBlend;
      const breathing = reducedMotion ? 0 : Math.sin(elapsed * 1.12);
      const weightShift = reducedMotion ? 0 : Math.sin(elapsed * 0.38) * 0.006;
      look +=
        ((reducedMotion ? 0 : Math.max(-1, Math.min(1, pointerX)) * 0.13) - look) *
        (1 - Math.exp(-delta * 1.7));
      offset(leftArm, leftArmRest, breathing * 0.004, 0, weightShift * 0.5);
      offset(leftForearm, leftForearmRest, breathing * 0.003, 0, 0);
      leftHand.quaternion.copy(leftHandRest);
      rightArm.quaternion.slerpQuaternions(armRest, armWave, armWeight || 0);
      rightForearm.quaternion.slerpQuaternions(forearmRest, forearmWave, elbowWeight || 0);
      const wristSway = Math.sin((age - 0.8) * 7.4) * 0.16 * wristWeight || 0;
      offset(rightHand, handRest, 0, wristSway * 0.2, wristSway);
      offset(spine, spineRest, breathing * 0.003, 0, weightShift);
      offset(chest, chestRest, breathing * 0.005 + thinkingWeight * 0.012, 0, -weightShift * 0.65);
      const nodAge = elapsed - nodStart;
      const nod = !reducedMotion && nodAge < 1.5 ? Math.sin((nodAge * Math.PI) / 1.5) * 0.055 : 0;
      offset(head, headRest, nod + thinkingWeight * 0.025, look, concernedWeight * 0.018);
      const walk = reducedMotion ? 0 : (travel?.walk ?? 0);
      const reach = reducedMotion ? 0 : (travel?.reach ?? 0);
      const stride = travel?.stride ?? 0;
      const sit = travel?.sit ?? 0;
      if (walk > 0) {
        rotation.setFromAxisAngle(leftSwingAxis, Math.sin(stride) * 0.25 * walk);
        leftArm.quaternion.copy(leftArmRest).multiply(rotation);
        rotation.setFromAxisAngle(rightSwingAxis, -Math.sin(stride) * 0.25 * walk);
        rightArm.quaternion.copy(armRest).multiply(rotation);
        offset(head, headRest, 0, 0, 0);
      }
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        if (!leg) continue;
        const phase = stride + i * Math.PI;
        const swing = Math.sin(phase);
        const lift = Math.max(0, Math.cos(phase));
        if (leg.thigh && leg.thighRest)
          leg.thigh.quaternion
            .copy(leg.thighRest)
            .multiply(rotation.setFromAxisAngle(leg.thighAxis, -swing * 0.32 * walk));
        if (leg.knee && leg.kneeRest)
          leg.knee.quaternion
            .copy(leg.kneeRest)
            .multiply(rotation.setFromAxisAngle(leg.kneeAxis, lift * 0.5 * walk));
        if (leg.foot && leg.footRest)
          leg.foot.quaternion
            .copy(leg.footRest)
            .multiply(rotation.setFromAxisAngle(leg.footAxis, (swing * 0.18 - lift * 0.2) * walk));
        if (leg.thigh && leg.thighSeated) leg.thigh.quaternion.slerp(leg.thighSeated, sit);
        if (leg.knee && leg.kneeSeated) leg.knee.quaternion.slerp(leg.kneeSeated, sit);
      }
      if (reach > 0) {
        rightArm.quaternion.slerp(armReach, reach);
        rightForearm.quaternion.slerp(forearmReach, reach);
      }
      if (sit > 0) {
        leftHand.quaternion.slerp(leftHandSeated, sit);
        rightHand.quaternion.slerp(rightHandSeated, sit * (1 - (wristWeight || 0)));
        leftArm.quaternion.slerp(leftArmSeated, sit);
        leftForearm.quaternion.slerp(leftForearmSeated, sit);
        rightArm.quaternion.slerp(rightArmSeated, sit * (1 - (armWeight || 0)));
        rightForearm.quaternion.slerp(rightForearmSeated, sit * (1 - (elbowWeight || 0)));
      }
      const typingWeight = Math.max(0, Math.min(1, typing));
      if (typingWeight > 0) {
        if (head && headTyping) head.quaternion.slerp(headTyping, typingWeight);
        leftArm.quaternion.slerp(leftArmTyping, typingWeight);
        rightArm.quaternion.slerp(rightArmTyping, typingWeight);
        leftForearm.quaternion.slerp(leftForearmTyping, typingWeight);
        rightForearm.quaternion.slerp(rightForearmTyping, typingWeight);
      }
      digits.forEach((digit, index) => {
        digit.bone.quaternion.copy(digit.rest);
        if (!reducedMotion && typingWeight > 0)
          digit.bone.rotateX(Math.sin(elapsed * 7.5 + index * 1.7) * 0.055 * typingWeight);
      });
    },
  };
}
