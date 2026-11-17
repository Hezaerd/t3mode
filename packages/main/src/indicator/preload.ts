// The desktop indicator window's preload. It gives the page these three calls and nothing else.
import { contextBridge, ipcRenderer } from "electron";

import type { FromIndicator, ToIndicator } from "@t3mode/shared/Backends";
import { Channel } from "@t3mode/shared/Ipc";

const send = (message: FromIndicator) => ipcRenderer.send(Channel.fromIndicator, message);

contextBridge.exposeInMainWorld("t3modeIndicator", {
  onModel: (listener: (message: ToIndicator) => void) => {
    ipcRenderer.on(Channel.toIndicator, (_event, message: ToIndicator) => listener(message));
  },
  painted: (epoch: string, n: number) => send({ op: "painted", epoch, n }),
  stop: (epoch: string) => send({ op: "stop", epoch }),
});
