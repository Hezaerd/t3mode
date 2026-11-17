// The "Updates" section of the T3 Mode page: T3 Code's version, what t3mode's updater is doing,
// and the switch that hands updates back to T3 Code's own updater. It redraws itself on every
// status main pushes (see @t3mode/shared/Updates), so a download shows its progress live.
// @effect-diagnostics globalDate:off - plain page code; only the relative "checked" time
import type { UpdateStatus } from "@t3mode/shared/Updates";

import type { Runtime } from "../Runtime.ts";
import { button, group, row, section, switchControl } from "./native.ts";

const MB = 1024 * 1024;

const ago = (at: number | null): string => {
  if (at === null) return "";
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return " Checked just now.";
  if (minutes < 60) return ` Checked ${minutes} minute${minutes === 1 ? "" : "s"} ago.`;
  const hours = Math.floor(minutes / 60);
  return ` Checked ${hours} hour${hours === 1 ? "" : "s"} ago.`;
};

const describeStatus = (status: UpdateStatus): string => {
  if (!status.managed) {
    return status.manageSetting
      ? "T3 Mode installs updates from the next launch. Until then T3 Code's own updater runs, and an update it installs removes T3 Mode."
      : 'T3 Code\'s own updater installs updates, and each one removes T3 Mode. Run "t3mode repair" after an update.';
  }
  if (!status.manageSetting) {
    return "Turned off. From the next launch, T3 Code's own updater installs updates, and each one removes T3 Mode.";
  }
  const { phase } = status;
  switch (phase.kind) {
    case "idle":
      return "The first check runs shortly after T3 Code starts.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return `Up to date on the ${status.channel} channel.${ago(status.checkedAt)}`;
    case "downloading": {
      const percent = phase.total > 0 ? Math.floor((phase.received / phase.total) * 100) : 0;
      return `Downloading ${phase.version}: ${percent}% of ${Math.round(phase.total / MB)} MB.`;
    }
    case "verifying":
      return `Checking the download of ${phase.version}.`;
    case "ready":
      return status.installable
        ? `${phase.version} is ready. It installs when T3 Code quits, and T3 Mode puts itself back.`
        : `${phase.version} is downloaded and verified. The sandbox never installs T3 Code's real installer.`;
    case "failed":
      return `${phase.message}${ago(status.checkedAt)}`;
  }
};

const rows = (runtime: Runtime, status: UpdateStatus | undefined): ReadonlyArray<HTMLElement> => {
  if (!status) {
    return [row({ title: "T3 Code", description: "Reading the update status…" })];
  }
  const { phase } = status;
  const check = () =>
    button({
      text: "Check now",
      icon: "retry",
      variant: "outline",
      onClick: () => void runtime.update("check"),
    });
  const control =
    !status.managed || !status.manageSetting
      ? null
      : phase.kind === "ready"
        ? status.installable
          ? button({
              text: "Restart now",
              icon: "retry",
              variant: "outline",
              onClick: () => void runtime.update("restart"),
            })
          : null
        : phase.kind === "idle" || phase.kind === "up-to-date" || phase.kind === "failed"
          ? check()
          : null;
  return [
    row({ title: `T3 Code ${status.current}`, description: describeStatus(status), control }),
    row({
      title: "Install updates through T3 Mode",
      description:
        "T3 Code's own updater removes T3 Mode with every update. T3 Mode installs the same updates, checks they are signed by T3 Code's publisher, and puts itself back. A change applies when T3 Code restarts.",
      control: switchControl({
        label: "Install updates through T3 Mode",
        checked: status.manageSetting,
        onChange: (checked) => void runtime.setManageUpdates(checked),
      }),
    }),
  ];
};

export const updatesSection = (runtime: Runtime): HTMLElement => {
  const body = group(...rows(runtime, runtime.updateStatus));
  const stop = runtime.onUpdate((status) => {
    if (!body.isConnected) {
      stop();
      return;
    }
    body.replaceChildren(...rows(runtime, status));
  });
  return section("Updates", null, body);
};
