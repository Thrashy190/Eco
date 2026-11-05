import { cx } from "../lib/ui";
import { myDeviceName, selectDevice, selfId, useConnect } from "../stores/connect";
import { openSheet } from "../stores/ui";
import { Icon } from "./Icon";

/** Choose where the music plays, among the devices signed in to this account. */
export function openDevicePicker(): void {
  const { devices, target } = useConnect.getState();
  const active = target ?? selfId;
  const list = devices.length ? devices : [{ id: selfId, name: myDeviceName() }];
  const alone = list.length < 2;
  openSheet("Listen on", alone ? "Open Eco on another device with this account and it appears here" : undefined,
    list.map((device) => ({
      icon: device.id === active ? "check" : "devices",
      label: device.id === selfId ? `${device.name} (this device)` : device.name,
      run: () => void selectDevice(device.id),
    })));
}

/** Shows where the music plays and opens the picker. */
export function DeviceButton({ name }: { name: string }) {
  return (
    <button type="button" className={cx("inline-flex items-center justify-center gap-2 self-center px-3.5 py-2 rounded-full font-[650] text-[.88rem] text-muted", name && "text-accent! bg-[rgb(var(--glow)/.14)]")} onClick={openDevicePicker}>
      <Icon name="devices" size={18} />{name ? `Playing on ${name}` : "This device"}
    </button>
  );
}
