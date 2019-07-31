import { networkInterfaces } from "os";
// @ts-ignore
import localIp from "local-ip";

export default function getLocalIp() {
  const ifaces = networkInterfaces();
  const iface = Object.keys(ifaces).find(
    name => !ifaces[name].some(iface => iface.address === "127.0.0.1")
  );

  console.log(`[UTL] First interface except for loop is '${iface}'.`);

  const ip = localIp(iface);

  return ip;
}
